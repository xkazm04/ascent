// CRAFT'S TWO DIFFERENCES from a gap, in the pure module that owns both.
//
//   1. THE RESOLVE RULE. A craft rung closes on its `Ascent-Resolves:` trailer and on nothing else.
//      The movement witness a gap needs is unavailable — a rung raises a ceiling the rubric has no
//      headroom to record — and "no longer restated" is even weaker for craft than for a gap, because
//      a craft entry is re-derived from an unbounded question on every scan.
//   2. THE BRIEF. Same invitational voice, but the instruction is to raise the ceiling, not to close
//      a gap. It must still end with the `RESOLVED: <id> - …` lines the lane parser expects, or the
//      whole session's account is lost.

import { describe, expect, it } from "vitest";
import { buildFixPrompt, decideInProgress, keepNote, resolutionNote, type FollowUpItem } from "./followups";

const ids = (...v: string[]) => new Set(v);

const item = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id: "rec-1",
  repo: "acme/widget",
  title: "A performance budget that fails CI",
  dimId: "D2",
  dimLabel: "Testing & Verification",
  impact: "medium",
  effort: "medium",
  rationale: "The suite measures; nothing fails on a regression.",
  explore: ["What number would you defend?"],
  projectedPoints: null,
  kind: "craft",
  craftAxis: "performance",
  ...over,
});

describe("decideInProgress — the craft rule", () => {
  it("closes a craft rung on its trailer, with no movement to show", async () => {
    // A gap in this exact position (no movement recorded) would be closed too, but a gap on a FLAT
    // dimension would be kept. Craft is not kept, because flat is the expected outcome.
    const d = decideInProgress({ id: "rec-1", kind: "craft" }, false, ids("rec-1"), { before: 92, after: 92 });
    expect(d).toEqual({ kind: "done", reason: "trailer" });
    expect(resolutionNote(d, "abc123")).toContain("Ascent-Resolves");
  });

  it("KEEPS an unclaimed craft rung even though the scan stopped raising it", async () => {
    const d = decideInProgress({ id: "rec-1", kind: "craft" }, false, ids());
    expect(d).toEqual({ kind: "keep", reason: "craft-unclaimed" });
    expect(keepNote(d, "abc123")).toContain("re-derived every scan");
  });

  it("keeps a restated craft rung, exactly as it keeps a restated gap", async () => {
    expect(decideInProgress({ id: "rec-1", kind: "craft" }, true, ids("rec-1"))).toEqual({
      kind: "keep",
      reason: "claimed-but-restated",
    });
  });

  it("leaves the GAP rules byte-identical — an absent kind is a gap", async () => {
    // The pre-r12 call shape, unchanged: a flat dimension keeps the row open however many trailers.
    expect(decideInProgress({ id: "rec-1" }, false, ids("rec-1"), { before: 50, after: 50 })).toEqual({
      kind: "keep",
      reason: "no-movement",
    });
    expect(decideInProgress({ id: "rec-1" }, false, ids("rec-1"), { before: 50, after: 70 })).toEqual({
      kind: "done",
      reason: "trailer",
    });
  });
});

describe("buildFixPrompt — the craft brief", () => {
  const ctx = { org: "acme", generatedAt: "2026-08-30", commitPolicy: "lane" as const };

  it("frames the batch as rungs above the band, never as gaps owed", async () => {
    const p = buildFixPrompt([item()], ctx);
    expect(p).toContain("# Ascent craft ladder");
    expect(p).toContain("no open gaps left");
    expect(p).toContain("raise the ceiling, not to close a gap");
    expect(p).toContain("none of the items below is a fault");
  });

  // The artefact rule and the no-gaming rule survive; the two sentences that ranked a CHECK above the
  // change it would ask for are deleted (reflection 2026-09-01, finding 3).
  it("demands a named artefact, sets the bar at the code, and no longer asks for one small rung", async () => {
    const p = buildFixPrompt([item()], ctx);
    expect(p).toContain("Leave an ARTEFACT");
    expect(p).toContain("Do not lower any existing bar");
    expect(p).toContain("THE BAR IS THE CODE ITSELF");
    expect(p).not.toContain("one rung, not a redesign");
    expect(p).not.toContain("Prefer something that RUNS");
  });

  it("still ends with the RESOLVED lines the lane parser reads", async () => {
    const p = buildFixPrompt([item()], ctx);
    expect(p).toContain("RESOLVED: <id> - <what changed>");
    expect(p).toContain("at most 8 words, verb-first, past tense");
  });

  it("names the axis on the item line and prints NO maturity points", async () => {
    const p = buildFixPrompt([item()], ctx);
    expect(p).toContain("axis performance");
    expect(p).toContain("already green; these raise the ceiling");
    expect(p).not.toContain("maturity points if all close");
    expect(p).not.toContain("pts");
  });

  it("a gap batch is untouched — the craft voice appears nowhere in it", async () => {
    const p = buildFixPrompt([item({ kind: undefined, craftAxis: null, projectedPoints: 4 })], ctx);
    expect(p).toContain("# Ascent follow-ups");
    expect(p).toContain("+4 maturity points if all close");
    expect(p).not.toContain("craft ladder");
    expect(p).not.toContain("Leave an ARTEFACT");
  });

  it("a MIXED batch is treated as gaps — craft mode requires every item to be craft", async () => {
    // Defense in depth: `openBatch` never mixes, but a hand-curated batch could.
    const p = buildFixPrompt([item(), item({ id: "rec-2", kind: undefined })], ctx);
    expect(p).toContain("# Ascent follow-ups");
  });
});
