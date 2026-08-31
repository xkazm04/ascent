import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LLM_GUARDBAND } from "@/lib/maturity/model";
import { CLAIM_SCORED_DIMENSIONS } from "@/lib/scoring/claims";
import { SIGNAL_ONLY_DIMENSIONS, scoreProvenance } from "@/lib/scoring/provenance";
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
