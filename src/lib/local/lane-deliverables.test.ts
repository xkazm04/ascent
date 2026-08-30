// The deliverable derivation — headlines from the agent's own claims, the lane kind and the
// ATTRIBUTABLE diff, and nothing from a diff the attribution rule refused.

import { describe, expect, it } from "vitest";
import { DIMENSIONS } from "@/lib/maturity/model";
import { diffScans } from "@/lib/report/compare";
import type { ComparableScan } from "@/lib/db/scans";
import { deriveLaneDeliverables, movementHeadline, parseClaimLines, tidyHeadline } from "@/lib/local/lane-deliverables";

const scan = (p: Partial<ComparableScan> & { id: string }): ComparableScan => ({
  scannedAt: "2026-08-22T10:00:00.000Z", overallScore: 50, level: "L3", levelName: "Augmented", archetype: "org",
  adoptionScore: 50, rigorScore: 50, posture: "manual", confidence: 0.8, engineProvider: "anthropic", engineModel: "claude",
  engineDegraded: false, headSha: null,
  dimensions: DIMENSIONS.map((d) => ({ dimId: d.id, name: d.name, score: 50, signalScore: 50, evidence: [], gaps: [] })),
  recommendations: [], ...p,
});
const rec = (id: string, title: string, dimId = "D9", status = "open") => ({ id, title, dimId, status });
const withD9 = (id: string, score: number, evidence: string[], recs: ReturnType<typeof rec>[] = []) =>
  scan({
    id,
    overallScore: score,
    recommendations: recs,
    dimensions: DIMENSIONS.map((d) => (d.id === "D9" ? { dimId: d.id, name: d.name, score, signalScore: score, evidence, gaps: [] } : { dimId: d.id, name: d.name, score: 50, signalScore: 50, evidence: [], gaps: [] })),
  });

const before = withD9("b", 30, ["Token permissions [posture/high]: 0/10 — 0/3 workflows set an explicit `permissions:` scope."], [rec("rec-1", "The workflow tokens run with default write scope")]);
const after = withD9("a", 62, ["Token permissions [posture/high]: 10/10 — 3/3 workflows set an explicit `permissions:` scope.", "SAST [posture/medium]: 10/10 — SAST runs on PR/push."], [rec("rec-1", "The workflow tokens run with default write scope", "D9", "done")]);
const attributable = { kind: "attributable" as const, delta: 32 };

describe("parseClaimLines / tidyHeadline", () => {
  it("keeps the clause the agent wrote, tolerant of list markers, backticks and separators", () => {
    const claims = parseClaimLines("Done.\n- RESOLVED: `rec-1` - Added permissions scope to 3 workflows\nRESOLVED: rec-2 — wired CodeQL on pull_request.\nSKIPPED: rec-3 - not applicable\n");
    expect(claims).toEqual([
      { id: "rec-1", what: "Added permissions scope to 3 workflows" },
      { id: "rec-2", what: "wired CodeQL on pull_request." },
    ]);
  });
  it("capitalises, strips a leading 'I', trims punctuation and caps at 8 words", () => {
    expect(tidyHeadline("I added a `permissions:` block to every workflow file in the repo.")).toBe("Added a permissions: block to every workflow file");
    expect(tidyHeadline("   ")).toBeNull();
  });
});

describe("deriveLaneDeliverables", () => {
  it("turns each RESOLVED clause into a closed headline with the follow-up as evidence", () => {
    const out = deriveLaneDeliverables({ kind: "backlog", agentClaims: [{ id: "rec-1", what: "added permissions scope to 3 workflows" }], diff: diffScans(before, after), before, after, verdict: attributable });
    expect(out[0]).toEqual({ headline: "Added permissions scope to 3 workflows", dimId: "D9", kind: "closed", covers: ["rec-1"], evidence: "The workflow tokens run with default write scope" });
    // D9 moved but the close already covers it — no second "Hardened CI/CD security" row.
    expect(out.filter((d) => d.dimId === "D9")).toHaveLength(1);
  });

  it("backfills a close with no clause from the dimension template — one row per gap, never folded", () => {
    const out = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(before, after), before, after, verdict: attributable, closedFollowUpIds: ["rec-1"] });
    expect(out).toEqual([{ headline: "Hardened CI/CD security", dimId: "D9", kind: "closed", covers: ["rec-1"], evidence: "The workflow tokens run with default write scope" }]);
    // Two closes in one dimension stay TWO rows (the evidence tells them apart) — gap-level control.
    const b2 = withD9("b", 30, [], [rec("rec-1", "Tokens run with write scope"), rec("rec-2", "No SAST configured")]);
    const a2 = withD9("a", 62, [], [rec("rec-1", "Tokens run with write scope", "D9", "done"), rec("rec-2", "No SAST configured", "D9", "done")]);
    const two = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(b2, a2), before: b2, after: a2, verdict: attributable, closedFollowUpIds: ["rec-1", "rec-2"] });
    expect(two.filter((d) => d.kind === "closed").map((d) => d.covers)).toEqual([["rec-1"], ["rec-2"]]);
  });

  it("names an attributable movement not covered by a close, with the humanised line as evidence", () => {
    const b = withD9("b", 30, ["SAST [posture/medium]: 0/10 — none"]);
    const a = withD9("a", 62, ["SAST [posture/medium]: 10/10 — SAST runs on PR/push.", "Signed releases [posture/high]: 10/10 — cosign."]);
    const out = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(b, a), before: b, after: a, verdict: attributable });
    expect(out).toEqual([{ headline: "Hardened CI/CD security", dimId: "D9", kind: "hardened", covers: ["SAST", "signed releases"], evidence: "D9 +32 · changed SAST; gained signed releases" }]);
    const down = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(a, b), before: a, after: b, verdict: { kind: "attributable", delta: -32 } });
    expect(down[0]!.kind).toBe("regressed");
    expect(down[0]!.headline).toBe("Regressed on security posture");
  });

  it("emits NO movement headline under a refused verdict — undelivered, within noise, mock, unmeasured", () => {
    const b = withD9("b", 30, ["SAST [posture/medium]: 0/10 — none"]);
    const a = withD9("a", 62, ["SAST [posture/medium]: 10/10 — SAST runs on PR/push."]);
    for (const verdict of [{ kind: "undelivered" as const, delta: 32 }, { kind: "within-noise" as const, delta: 1 }, { kind: "mock-scan" as const, delta: 32, degraded: false }, { kind: "unmeasured" as const }]) {
      expect(deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(b, a), before: b, after: a, verdict })).toEqual([]);
    }
  });

  it("names a deterministic lane's install, and keeps EVERY resolved claim as its own row (no cap)", () => {
    expect(deriveLaneDeliverables({ kind: "foundation", agentClaims: [], diff: null, before: null, after: null, verdict: { kind: "unmeasured" } })[0]!.headline).toBe("Installed the .ai/ foundation");
    expect(deriveLaneDeliverables({ kind: "practice", agentClaims: [], diff: null, before: null, after: null, verdict: { kind: "unmeasured" }, practiceName: "pr review rigor" })[0]!.headline).toBe("Installed pr review rigor starter");
    const claims = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, what: `Did thing number ${i}` }));
    expect(deriveLaneDeliverables({ kind: "backlog", agentClaims: claims, diff: null, before: null, after: null, verdict: { kind: "unmeasured" } })).toHaveLength(9);
    // ...deduping only a TRUE duplicate: the same id claimed twice.
    const dup = deriveLaneDeliverables({ kind: "backlog", agentClaims: [{ id: "r1", what: "Did the thing" }, { id: "r1", what: "Did the thing" }], diff: null, before: null, after: null, verdict: { kind: "unmeasured" } });
    expect(dup).toHaveLength(1);
  });

  it("uses the per-dimension templates", () => {
    expect(movementHeadline("D9", true)).toBe("Hardened CI/CD security");
    expect(movementHeadline("D8", true)).toBe("Added agent-readable docs");
    expect(movementHeadline("D5", false)).toBe("Regressed on documentation");
  });
});
