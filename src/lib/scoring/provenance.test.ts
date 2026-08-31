import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LLM_GUARDBAND, SCORE_BLEND } from "@/lib/maturity/model";
import { CLAIM_SCORED_DIMENSIONS } from "@/lib/scoring/claims";
import {
  SIGNAL_ONLY_DIMENSIONS,
  blendWeightLabel,
  blendWeightPercent,
  scoreProvenance,
} from "@/lib/scoring/provenance";
import { integrityNotes } from "@/lib/maturity/attribution";
import type { ScoreIntegrity } from "@/lib/types";

const CLEAN: ScoreIntegrity = { d9Unmeasurable: false, widenedDims: [], effectiveBlend: 0.6 };

describe("scoreProvenance", () => {
  it("reports a claim-scored dimension as having NO band and NO judgment blend", () => {
    // D1/D4 are scored signal + verified citations (engine.ts). A band drawn here is a lever the
    // reader does not have — the whole MC-B3 defect.
    for (const id of CLAIM_SCORED_DIMENSIONS) {
      const p = scoreProvenance({ id, signalScore: 40, score: 47 }, CLEAN);
      expect(p.kind).toBe("claim-scored");
      if (p.kind !== "claim-scored") throw new Error("unreachable");
      expect(p.claimPoints).toBe(7);
    }
  });

  it("reports D9 as signal-only — the battery's number, which the model narrates and never moves", () => {
    const p = scoreProvenance({ id: "D9", signalScore: 30, score: 30 }, CLEAN);
    expect(p.kind).toBe("signal-only");
  });

  it("DOUBLES the clamp band on a widened dimension and leaves its neighbours at the base band", () => {
    // The report header's integrity chip says "widened D2, D6". Before this the track drew ±6 on all
    // nine, contradicting the chip on the same page.
    const si: ScoreIntegrity = { ...CLEAN, widenedDims: ["D2", "D6"], effectiveBlend: 1 };
    const widened = scoreProvenance({ id: "D2", signalScore: 50, score: 56 }, si);
    const plain = scoreProvenance({ id: "D3", signalScore: 50, score: 53 }, si);
    expect(widened.kind === "blended" && widened.clampBand).toBe(LLM_GUARDBAND * 2);
    expect(widened.kind === "blended" && widened.widened).toBe(true);
    expect(plain.kind === "blended" && plain.clampBand).toBe(LLM_GUARDBAND);
    expect(plain.kind === "blended" && plain.widened).toBe(false);
  });

  it("shrinks the REACH by the realized blend weight — the clamp is not how far the score can move", () => {
    // score = round(blend·guarded + (1-blend)·signal), so the model's realized pull on the RENDERED
    // number is blend × band, not band.
    const p = scoreProvenance({ id: "D3", signalScore: 50, score: 53 }, { ...CLEAN, effectiveBlend: 0.5 });
    expect(p.kind === "blended" && p.reach).toBe(Math.round(0.5 * LLM_GUARDBAND));
    expect(p.kind === "blended" && p.blend).toBe(0.5);
  });

  it("reports an UNKNOWN blend weight as null and falls back to the full clamp, never assuming one", () => {
    const p = scoreProvenance({ id: "D3", signalScore: 50, score: 53 }, undefined);
    expect(p.kind === "blended" && p.blend).toBeNull();
    expect(p.kind === "blended" && p.reach).toBe(LLM_GUARDBAND);
  });
});

describe("SIGNAL_ONLY_DIMENSIONS", () => {
  it("lists every dimension the score input actually flags `deterministic`", () => {
    // Structural pin, not a restatement: the producer is `scan-score-input.ts`, which rewrites a
    // dimension's signal with `deterministic: true`. If a second dimension joins it, the track must
    // stop drawing that one a guardband too — so this fails until the constant is updated.
    const src = readFileSync("src/lib/scan-score-input.ts", "utf8");
    const flagged = new Set<string>();
    for (const m of src.matchAll(/s\.id === "(D\d+)"[\s\S]{0,200}?deterministic: true/g)) flagged.add(m[1]!);
    expect(flagged.size).toBeGreaterThan(0);
    for (const id of flagged) expect(SIGNAL_ONLY_DIMENSIONS as readonly string[]).toContain(id);
  });

  it("never overlaps the claim-scored set — a dimension has exactly one mechanism", () => {
    for (const id of SIGNAL_ONLY_DIMENSIONS) {
      expect(CLAIM_SCORED_DIMENSIONS as readonly string[]).not.toContain(id);
    }
  });
});

// The report page prints the blend weight twice — the header's integrity chip and every blended
// dimension's provenance track. They printed it in two units (UAT `RC-N1`); this pins that they now
// read one composer, so a future edit to either surface cannot re-open the gap silently.
describe("blend weight — one unit for both surfaces", () => {
  it("is the ABSOLUTE weight, the number `reach` is derived from — not a share of the configured one", () => {
    expect(blendWeightPercent(0.57)).toBe(57);
    expect(blendWeightPercent(0.3)).toBe(30);
    // The share-of-configured reading of 0.57 (95%) is exactly what the chip used to print.
    expect(blendWeightPercent(0.57)).not.toBe(Math.round((0.57 / SCORE_BLEND) * 100));
  });

  it("carries the configured weight as context in the chip label, so 'reduced' stays legible", () => {
    expect(blendWeightLabel(0.3)).toBe(`blend weight 30% of ${blendWeightPercent(SCORE_BLEND)}%`);
  });

  it("gives the integrity chip and a provenance track the same percent for one scan", () => {
    const si: ScoreIntegrity = { d9Unmeasurable: false, widenedDims: [], effectiveBlend: 0.3 };
    const note = integrityNotes(si).find((n) => n.label.startsWith("blend weight"));
    const p = scoreProvenance({ id: "D2", signalScore: 50, score: 52 }, si);
    if (p.kind !== "blended" || p.blend === null) throw new Error("unreachable");
    expect(note?.label).toContain(`${blendWeightPercent(p.blend)}%`);
  });
});
