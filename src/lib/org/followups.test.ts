// The follow-ups loop, pinned at its three pure joints: the trailer parser, the resolve rule for
// in-progress rows, and the prompt builder's shape.

import { describe, it, expect } from "vitest";
import { FOLLOWUP_TRAILER, buildFixPrompt, decideInProgress, isRestated, keepNote, parseResolvedIds, resolutionNote, type FollowUpItem } from "./followups";
import { MOCK_ENGINE, SCORE_NOISE_BAND } from "@/lib/maturity/attribution";

const item = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id: "rec-1",
  repo: "acme/api",
  title: "Agent guidance is thin — agents have little to go on",
  dimId: "D1",
  dimLabel: "AI Tooling",
  impact: "high",
  effort: "low",
  rationale: "Without guidance every AI change re-derives the conventions.",
  explore: ["Which conventions do reviewers repeat most?"],
  projectedPoints: 6,
  ...over,
});

describe("parseResolvedIds", () => {
  it("reads one or several ids per trailer line, across commits, case-insensitively", () => {
    const ids = parseResolvedIds([
      "feat: add CLAUDE.md\n\nAscent-Resolves: rec-1",
      "fix tests\n\nascent-resolves: rec-2, rec-3\nCo-Authored-By: x",
      "unrelated commit",
    ]);
    expect([...ids].sort()).toEqual(["rec-1", "rec-2", "rec-3"]);
  });

  it("ignores the key when it is not at the start of a line (prose mention, not a trailer)", () => {
    expect(parseResolvedIds(["this mentions Ascent-Resolves: rec-9 in a sentence"]).size).toBe(0);
  });
});

describe("decideInProgress — the resolve rule", () => {
  it("a trailer closes a row the scan no longer restates, and names itself as the reason", () => {
    // The name of this case read "a trailer wins even when the scan still restates the gap" until
    // 2026-08-28 — the behaviour it was written for in 2026-08-26, and the exact opposite of what the
    // assertion below has checked ever since (note the `false`: the gap is NOT restated here). The
    // trailer-vs-restatement case is `claimed-but-restated`, two cases down.
    expect(decideInProgress({ id: "a" }, false, new Set(["a"]))).toEqual({ kind: "done", reason: "trailer" });
  });
  it("not restated → done; restated without a trailer → keep", () => {
    expect(decideInProgress({ id: "a" }, false, new Set())).toEqual({ kind: "done", reason: "not-restated" });
    expect(decideInProgress({ id: "a" }, true, new Set())).toEqual({ kind: "keep", reason: "restated" });
  });

  // 2026-08-26: the trailer is a HINT, not a verdict, and "not restated" needs the dimension to have
  // moved when movement is measurable — the loop's agent writes the trailer, and a reworded gap
  // produces the same "not restated" signal a fixed one does.
  it("keeps a row the agent claimed when the rescan still restates it, and says so", () => {
    const d = decideInProgress({ id: "a" }, true, new Set(["a"]));
    expect(d).toEqual({ kind: "keep", reason: "claimed-but-restated" });
    expect(keepNote(d, "abc123")).toMatch(/Claimed resolved by commit trailer.*still raises it/);
  });

  it("keeps a not-restated row whose dimension did not move — rephrasing is not repair", () => {
    const d = decideInProgress({ id: "a" }, false, new Set(["a"]), { before: 61, after: 61 });
    expect(d).toEqual({ kind: "keep", reason: "no-movement" });
    expect(keepNote(d, "abc123", { before: 61, after: 61 })).toMatch(/did not move \(61 → 61\)/);
    expect(decideInProgress({ id: "a" }, false, new Set(), { before: 61, after: 58 })).toEqual({ kind: "keep", reason: "no-movement" });
  });

  it("closes a not-restated row when the dimension moved — trailer or not", () => {
    expect(decideInProgress({ id: "a" }, false, new Set(["a"]), { before: 61, after: 70 })).toEqual({ kind: "done", reason: "trailer" });
    expect(decideInProgress({ id: "a" }, false, new Set(), { before: 61, after: 62 })).toEqual({ kind: "done", reason: "not-restated" });
  });

  it("falls back to the title rule when movement is unknown rather than inventing a measurement", () => {
    expect(decideInProgress({ id: "a" }, false, new Set(), null)).toEqual({ kind: "done", reason: "not-restated" });
    expect(keepNote({ kind: "keep", reason: "restated" }, "x")).toBe("");
  });
});

// 2026-08-28: "it moved" is not "the repository changed". When the caller can name the two engines,
// the same rule the cockpit ledger applies decides whether the movement is evidence at all — a
// follow-up must never close on model wobble, and never on a rescan that fell to the mock floor.
describe("decideInProgress — a claim never closes on an unattributable movement", () => {
  const real = { engineProvider: "anthropic", engineDegraded: false };
  const mock = { engineProvider: MOCK_ENGINE, engineDegraded: false };
  const degraded = { engineProvider: MOCK_ENGINE, engineDegraded: true };

  it("a MOCK rescan cannot close a row, however far the dimension moved", () => {
    const d = decideInProgress({ id: "a" }, false, new Set(["a"]), { before: 10, after: 90 }, { before: real, after: mock });
    expect(d).toEqual({ kind: "keep", reason: "mock-scan" });
    expect(keepNote(d, "abc123")).toMatch(/deterministic mock floor.*not on the same ruler/);
  });

  it("a mock BEFORE end refuses it too — either end breaks the comparison", () => {
    expect(
      decideInProgress({ id: "a" }, false, new Set(), { before: 10, after: 90 }, { before: mock, after: real }),
    ).toEqual({ kind: "keep", reason: "mock-scan" });
  });

  it("a degraded end is refused on the same grounds", () => {
    expect(
      decideInProgress({ id: "a" }, false, new Set(), { before: 10, after: 90 }, { before: real, after: degraded }),
    ).toEqual({ kind: "keep", reason: "mock-scan" });
  });

  it("a REAL pair inside the noise band is kept, and the note says which band it failed", () => {
    const d = decideInProgress(
      { id: "a" },
      false,
      new Set(["a"]),
      { before: 61, after: 61 + SCORE_NOISE_BAND },
      { before: real, after: real },
    );
    expect(d).toEqual({ kind: "keep", reason: "within-noise" });
    expect(keepNote(d, "abc123", { before: 61, after: 61 + SCORE_NOISE_BAND })).toMatch(
      new RegExp(`±${SCORE_NOISE_BAND}-point run-to-run noise band`),
    );
  });

  it("a REAL pair past the band closes the row exactly as before", () => {
    expect(
      decideInProgress(
        { id: "a" },
        false,
        new Set(["a"]),
        { before: 61, after: 61 + SCORE_NOISE_BAND + 1 },
        { before: real, after: real },
      ),
    ).toEqual({ kind: "done", reason: "trailer" });
  });

  it("a REAL pair that moved DOWN past the band is still not repair", () => {
    expect(
      decideInProgress({ id: "a" }, false, new Set(), { before: 61, after: 40 }, { before: real, after: real }),
    ).toEqual({ kind: "keep", reason: "no-movement" });
  });

  it("omitting the engines keeps the pre-attribution rule — no verdict is invented from absent data", () => {
    // The same 1-point movement that `within-noise` now refuses still closes when the caller has no
    // provenance to offer. That is deliberate: the rule tightens where evidence exists, nowhere else.
    expect(decideInProgress({ id: "a" }, false, new Set(), { before: 61, after: 62 })).toEqual({
      kind: "done",
      reason: "not-restated",
    });
  });
});

// Tiers 1-2 only. The third tier (lone-in-dimension pairing) is what carry-forward uses for OPEN
// rows and is excluded here on purpose: since r6 every below-green dimension always has some item,
// so a fixed gap would otherwise be paired with the dimension's next gap and stay "in progress".
describe("isRestated — title tiers only", () => {
  const prev = { dim: "D2", title: "No coverage threshold fails a run." };
  it("matches exact and normalised (case/punctuation) restatements", () => {
    expect(isRestated(prev, [{ dim: "D2", title: "No coverage threshold fails a run." }])).toBe(true);
    expect(isRestated(prev, [{ dim: "D2", title: "no coverage threshold fails a run" }])).toBe(true);
  });
  it("does NOT pair with a different gap in the same dimension, even when it is the only one", () => {
    expect(isRestated(prev, [{ dim: "D2", title: "Snapshot tests can bless a regression wholesale" }])).toBe(false);
  });
});

describe("resolutionNote", () => {
  it("names the mechanism and the scan", () => {
    expect(resolutionNote({ kind: "done", reason: "trailer" }, "abc123")).toContain(FOLLOWUP_TRAILER);
    expect(resolutionNote({ kind: "done", reason: "not-restated" }, "abc123")).toContain("no longer raised");
    expect(resolutionNote({ kind: "keep" }, "abc123")).toBe("");
  });
});

describe("buildFixPrompt", () => {
  const ctx = { org: "acme", generatedAt: "2026-08-17" };

  it("writes one section per repo, biggest projected gain first, items by impact then effort", () => {
    const p = buildFixPrompt(
      [
        item({ id: "a", repo: "acme/web", impact: "low", projectedPoints: 1 }),
        item({ id: "b", repo: "acme/api", impact: "medium", projectedPoints: 4 }),
        item({ id: "c", repo: "acme/api", impact: "high", projectedPoints: 5 }),
      ],
      ctx,
    );
    const apiAt = p.indexOf("## acme/api");
    const webAt = p.indexOf("## acme/web");
    expect(apiAt).toBeGreaterThan(-1);
    expect(apiAt).toBeLessThan(webAt); // 9 pts before 1 pt
    expect(p.indexOf("id: `c`")).toBeLessThan(p.indexOf("id: `b`")); // high before medium
    expect(p).toContain("up to +9 maturity points");
  });

  it("breaks an impact tie on effort CHEAPEST first, not most-expensive first", () => {
    // Effort ranks the opposite way to impact; ranking it through the IMPACT map put the dearest
    // item at the top of the repo's section — the reverse of the order a batch is worked in.
    const p = buildFixPrompt(
      [
        item({ id: "dear", impact: "high", effort: "high" }),
        item({ id: "cheap", impact: "high", effort: "low" }),
        item({ id: "mid", impact: "high", effort: "medium" }),
      ],
      ctx,
    );
    expect(p.indexOf("id: `cheap`")).toBeLessThan(p.indexOf("id: `mid`"));
    expect(p.indexOf("id: `mid`")).toBeLessThan(p.indexOf("id: `dear`"));
  });

  it("carries the scan's own words and the trailer instruction, and names every id", () => {
    const p = buildFixPrompt([item()], ctx);
    expect(p).toContain("Agent guidance is thin");
    expect(p).toContain("Why it matters: Without guidance");
    expect(p).toContain("Which conventions do reviewers repeat most?");
    expect(p).toContain(`\`${FOLLOWUP_TRAILER}: <id>\``);
    expect(p).toContain("id: `rec-1`");
    expect(p).toContain("1 item across 1 repository");
  });

  it("is deterministic for the same input", () => {
    const items = [item({ id: "x" }), item({ id: "y", repo: "acme/web" })];
    expect(buildFixPrompt(items, ctx)).toBe(buildFixPrompt(items, ctx));
  });
});
