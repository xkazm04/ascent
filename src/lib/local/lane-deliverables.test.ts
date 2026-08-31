// The deliverable derivation — headlines from the agent's own claims, the lane kind and the
// ATTRIBUTABLE diff, and nothing from a diff the attribution rule refused.

import { describe, expect, it } from "vitest";
import { DIMENSIONS } from "@/lib/maturity/model";
import { diffScans } from "@/lib/report/compare";
import type { ComparableScan } from "@/lib/db/scans";
import { deriveLaneDeliverables, movementHeadline, parseClaimLines, RETIRED_NOTE, tidyHeadline } from "@/lib/local/lane-deliverables";
import { BASE_DIVERGED_HEADLINE, baseRelationOf } from "@/lib/db/loop-runs-types";

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

  it("merges two ids the agent gave the SAME written headline, keeping BOTH in covers", () => {
    // A real run printed "Added gating evidence to agent review" twice: one piece of work the agent
    // attributed to two covered ids. One deliverable — but the sheet keys rows by the first cover,
    // so the second id must survive the merge or its gap drops off the review surface entirely.
    const out = deriveLaneDeliverables({
      kind: "backlog",
      agentClaims: [
        { id: "rec-1", what: "Added gating evidence to agent review" },
        { id: "rec-2", what: "added gating evidence to agent review." },
        { id: "rec-3", what: "Wired CodeQL on pull_request" },
      ],
      diff: null,
      before: null,
      after: null,
      verdict: { kind: "unmeasured" },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ headline: "Added gating evidence to agent review", covers: ["rec-1", "rec-2"] });
    expect(out[1]!.covers).toEqual(["rec-3"]);
  });

  it("does NOT merge two gaps that only share a TEMPLATE headline — that stays one row per gap", () => {
    // The template is OUR sentence, not the agent's, so a shared one is a coincidence of filing.
    const b = withD9("b", 30, [], [rec("rec-1", "Tokens run with write scope"), rec("rec-2", "No SAST configured")]);
    const a = withD9("a", 62, [], [rec("rec-1", "Tokens run with write scope", "D9", "done"), rec("rec-2", "No SAST configured", "D9", "done")]);
    // Both via the 1b backfill (no clause on file)…
    const backfilled = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(b, a), before: b, after: a, verdict: attributable, closedFollowUpIds: ["rec-1", "rec-2"] });
    expect(backfilled.map((d) => d.covers)).toEqual([["rec-1"], ["rec-2"]]);
    // …and both via a claim whose clause tidied to nothing, falling back to the same template.
    const fellBack = deriveLaneDeliverables({
      kind: "backlog",
      agentClaims: [{ id: "rec-1", what: "  " }, { id: "rec-2", what: "" }],
      diff: diffScans(b, a), before: b, after: a, verdict: attributable,
    });
    expect(fellBack.filter((d) => d.kind === "closed").map((d) => d.covers)).toEqual([["rec-1"], ["rec-2"]]);
  });

  it("is TOTAL: a lane that COMMITTED and CLOSED still produces a row when nothing resolves to a title", () => {
    // Run 94477208, exactly: `commits: 1`, `closedFollowUpIds: 16`, and neither scan carrying a
    // recommendation row for any of them. It derived `[]`, so the sheet rendered a project header
    // with no rows under it — the loop did work and reported nothing.
    const out = deriveLaneDeliverables({
      kind: "backlog",
      agentClaims: [],
      diff: null,
      before: null,
      after: null,
      verdict: { kind: "unmeasured" },
      commits: 1,
      closedFollowUpIds: ["ghost-1", "ghost-2", "ghost-3"],
    });
    // ONE counted row, not three identical placeholders — run 17681528's sixteen indistinguishable
    // "Closed a follow-up" rows are the failure this shape exists to prevent.
    expect(out).toHaveLength(1);
    expect(out[0]!.headline).toBe("Closed 3 follow-ups");
    expect(out[0]!.covers).toEqual(["ghost-1", "ghost-2", "ghost-3"]);
  });

  it("uses the follow-up's REAL TITLE as the headline when the recommendation carries no dimension", () => {
    // Run 17681528: sixteen rows per lane, every one reading "Closed a follow-up", off a single
    // commit. The ids were known and the titles were sitting in `before.recommendations[]` — the
    // derivation reached for a placeholder only because the row carried no `dimId`.
    const b = withD9("b", 30, [], [rec("r1", "Coverage gate is advisory only", ""), rec("r2", "No dependency review on PRs", "")]);
    const a = withD9("a", 62, [], [rec("r1", "Coverage gate is advisory only", "", "done"), rec("r2", "No dependency review on PRs", "", "done")]);
    const out = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(b, a), before: b, after: a, verdict: { kind: "unmeasured" }, commits: 1, closedFollowUpIds: ["r1", "r2"] });
    expect(out.map((d) => d.headline)).toEqual(["Coverage gate is advisory only", "No dependency review on PRs"]);
    expect(new Set(out.map((d) => d.headline)).size).toBe(out.length);
  });

  it("merges two ids the SCAN filed under the identical title, keeping both covers", () => {
    // A title-derived headline is the scan's own sentence, so the same one twice is one gap filed
    // twice — the same merge rule an agent-written clause goes through.
    const b = withD9("b", 30, [], [rec("r1", "Coverage gate is advisory only", ""), rec("r2", "Coverage gate is advisory only", "")]);
    const a = withD9("a", 62, [], [rec("r1", "Coverage gate is advisory only", "", "done"), rec("r2", "Coverage gate is advisory only", "", "done")]);
    const out = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(b, a), before: b, after: a, verdict: { kind: "unmeasured" }, closedFollowUpIds: ["r1", "r2"] });
    expect(out).toHaveLength(1);
    expect(out[0]!.covers).toEqual(["r1", "r2"]);
  });

  it("is TOTAL: a lane that committed and closed NOTHING still names what it did", () => {
    const b = withD9("b", 30, ["SAST [posture/medium]: 0/10 — none"]);
    const a = withD9("a", 62, ["SAST [posture/medium]: 10/10 — SAST runs on PR/push."]);
    // The verdict REFUSED the movement, so there is no `hardened` row — and the last-resort row is
    // `noted`, names the dimension the commits landed on, and claims no direction and no delta.
    const out = deriveLaneDeliverables({
      kind: "backlog",
      agentClaims: [],
      diff: diffScans(b, a),
      before: b,
      after: a,
      verdict: { kind: "undelivered", delta: 32 },
      commits: 3,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("noted");
    expect(out[0]!.headline).toBe("Committed 3 changes on Supply Chain & Security");
    expect(out[0]!.evidence).toBeNull();
    // And a lane that did NOTHING still derives nothing: totality is not a licence to invent a row.
    expect(deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(b, a), before: b, after: a, verdict: { kind: "undelivered", delta: 32 }, commits: 0 })).toEqual([]);
  });

  it("marks a close the agent never claimed as RETIRED, and keeps `closed` for what it did claim", () => {
    // The ten-rows-off-one-commit case: nine phantom D4 rows the rescan stopped raising after the
    // coverage-guarantee fix, one gap the agent actually closed. Counting all ten as output
    // overstates the loop, so only the claimed one is `closed`.
    const b = withD9("b", 30, [], [rec("rec-1", "Tokens run with write scope"), rec("rec-2", "Phantom D4 entry", "D4")]);
    const a = withD9("a", 62, [], [rec("rec-1", "Tokens run with write scope", "D9", "done"), rec("rec-2", "Phantom D4 entry", "D4", "done")]);
    const out = deriveLaneDeliverables({
      kind: "backlog",
      agentClaims: [{ id: "rec-1", what: "added permissions scope to 3 workflows" }],
      diff: diffScans(b, a),
      before: b,
      after: a,
      verdict: attributable,
      commits: 1,
      closedFollowUpIds: ["rec-1", "rec-2"],
    });
    const claimed = out.find((d) => d.covers.includes("rec-1"))!;
    const retired = out.find((d) => d.covers.includes("rec-2"))!;
    expect(claimed.retired).toBeUndefined();
    expect(claimed.headline).toBe("Added permissions scope to 3 workflows");
    expect(retired.retired).toBe(true);
    // The headline names WHICH follow-up (never the dimension's movement template — the rescan
    // dropping a row is not the loop hardening a dimension), and the evidence carries the words the
    // sheet needs while it cannot yet read the flag.
    expect(retired.headline).toBe("Phantom D4 entry");
    expect(retired.evidence).toBe(`${RETIRED_NOTE} Phantom D4 entry`);
  });

  it("collapses a MASS retirement of untitled ids into ONE counted row", () => {
    // Ten "closed" rows off a single commit, nine of them phantom D4 entries the coverage-guarantee
    // fix retired. Nine identical rows would overstate the loop's output nine times over.
    const out = deriveLaneDeliverables({
      kind: "backlog",
      agentClaims: [{ id: "rec-1", what: "wired CodeQL on pull_request" }],
      diff: null,
      before: null,
      after: null,
      verdict: { kind: "unmeasured" },
      commits: 1,
      closedFollowUpIds: ["rec-1", ...Array.from({ length: 9 }, (_, i) => `ghost-${i}`)],
    });
    expect(out).toHaveLength(2);
    const collapsed = out[1]!;
    expect(collapsed.headline).toBe("Retired 9 follow-ups no longer raised");
    expect(collapsed.retired).toBe(true);
    expect(collapsed.covers).toHaveLength(9);
  });

  it("does NOT claim `retired` when the lane's RESOLVED lines are not on file", () => {
    // The read-side backfill always passes `agentClaims: []` — the agent summary is not persisted.
    // "Unknown" is never evidence of "not claimed", so the row stays a plain close.
    const out = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(before, after), before, after, verdict: attributable, closedFollowUpIds: ["rec-1"] });
    expect(out[0]!.retired).toBeUndefined();
    expect(out[0]!.headline).toBe("Hardened CI/CD security");
  });

  it("uses the per-dimension templates", () => {
    expect(movementHeadline("D9", true)).toBe("Hardened CI/CD security");
    expect(movementHeadline("D8", true)).toBe("Added agent-readable docs");
    expect(movementHeadline("D5", false)).toBe("Regressed on documentation");
  });
});

// ── A PAIR WHOSE TWO ENDS WERE NOT TAKEN ON THE SAME BASE ───────────────────────────────────────
//
// Run a97baf88 (2026-08-30): `kp` read 92 → 84 and this derivation printed two `regressed` rows. The
// cause was a person switching the paired checkout from an autopilot branch to `main` between the two
// scans — two different trees. The refusal belongs in the same family as the platform-fold mismatch:
// no delta claimed in either direction, and a DISCLOSURE that names the cause, because a bare drop
// with no explanation reads as "the repository got worse".
describe("deriveLaneDeliverables — an incomparable base", () => {
  // The same pair as above, read backwards: D9 falls 62 → 30, which is an attributable regression
  // when the two ends are comparable.
  const regressing = { kind: "attributable" as const, delta: -32 };
  const derive = (base: "shared" | "diverged" | "unknown") =>
    deriveLaneDeliverables({
      kind: "backlog",
      agentClaims: [],
      diff: diffScans(after, before),
      before: after,
      after: before,
      verdict: base === "diverged" ? { kind: "unmeasured" as const, reason: "base" as const } : regressing,
      base,
      commits: 2,
    });

  it("emits no `regressed` row, and discloses the reason instead", () => {
    const rows = derive("diverged");
    expect(rows.some((d) => d.kind === "regressed")).toBe(false);
    const disclosure = rows.find((d) => d.headline === BASE_DIVERGED_HEADLINE);
    expect(disclosure).toBeDefined();
    expect(disclosure!.kind).toBe("noted");
    expect(disclosure!.evidence).toContain("not on one line of history");
    // It is a disclosure, not a review row: it covers no follow-up and claims no dimension.
    expect(disclosure!.covers).toEqual([]);
    expect(disclosure!.dimId).toBeNull();
  });

  it("still reports that the lane COMMITTED — the disclosure never suppresses the work", () => {
    // TOTALITY runs first on purpose: an operator needs both facts, "it committed" and "the number
    // beside it is not comparable".
    const rows = derive("diverged");
    expect(rows.some((d) => d.kind === "noted" && d.headline.startsWith("Committed 2 change"))).toBe(true);
  });

  it("leaves a comparable pair exactly as it was — and an UNKNOWN base is comparable", () => {
    for (const base of ["shared", "unknown"] as const) {
      const rows = derive(base);
      expect(rows.some((d) => d.kind === "regressed"), base).toBe(true);
      expect(rows.some((d) => d.headline === BASE_DIVERGED_HEADLINE), base).toBe(false);
    }
    // And the default (no `base` at all) behaves like `unknown`.
    const legacy = deriveLaneDeliverables({ kind: "backlog", agentClaims: [], diff: diffScans(after, before), before: after, after: before, verdict: regressing, commits: 2 });
    expect(legacy.some((d) => d.kind === "regressed")).toBe(true);
  });

  it("is recoverable from the persisted row, which is how the read side inherits the refusal", () => {
    // The lane has a checkout to ask git; `laneOutcome` and the cockpit's drift do not. The row IS
    // the record — and its absence stays `unknown`, never `shared`.
    expect(baseRelationOf(derive("diverged"))).toBe("diverged");
    expect(baseRelationOf(derive("shared"))).toBe("unknown");
    expect(baseRelationOf([])).toBe("unknown");
  });
});
