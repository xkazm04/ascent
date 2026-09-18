// The briefing is a PURE function over what the ledger already loaded. Pinned here: the consequence
// ranking, the five-line cap and its overflow, the predicate every count carries, the 24-hour wording
// when there is no anchor, silence when nothing happened, and a named error — never silence — when a
// read it depends on failed.

import { describe, expect, it } from "vitest";
import { BRIEFING_CAP, deriveBriefing, type BriefingInput } from "./briefingModel";
import { NOW, SEEN, at, chronicleRun, direction, plan, repoState, runnerDrive } from "./ledgerFixture";

const input = (over: Partial<BriefingInput> = {}): BriefingInput => ({
  now: NOW,
  seenAt: SEEN,
  runs: [],
  runsHasMore: false,
  pending: [],
  directions: [],
  runner: runnerDrive(),
  lastRunner: runnerDrive(),
  failed: [],
  ...over,
});

/** A world where every class has news since the 6-hours-ago anchor. */
const busy = (): BriefingInput => {
  const drive = runnerDrive({
    events: [
      { event: "repo-paused", at: at(2), repo: "acme/kp", reason: "branch-conflict", until: null, note: "conflict" },
      { event: "repo-paused", at: at(2), repo: "acme/web", reason: "dry-backoff", until: at(-1), note: "rest" },
      { event: "paused", at: at(20), repo: null, reason: "spend-ceiling", until: null, note: "old" },
    ],
  });
  return input({
    runs: [
      chronicleRun(9, { verifiedCloses: 2, landedAt: [at(1)], endedAt: at(1) }),
      chronicleRun(8, { verifiedCloses: 1, landedAt: [at(4), at(8)], endedAt: at(4), phase: "error" }),
      chronicleRun(7, { verifiedCloses: 5, landedAt: [at(9)], startedAt: at(10), endedAt: at(9) }),
    ],
    pending: [plan("p1"), plan("p2")],
    directions: [direction("d1", { status: "exhausted", endedAt: at(3) }), direction("d2", { status: "done", endedAt: at(2) }), direction("d3", { status: "done", endedAt: at(30) })],
    runner: drive,
    lastRunner: drive,
  });
};

describe("deriveBriefing — selection and ranking", () => {
  it("ranks by consequence: awaiting you, breakers, exhaustion, closes, landings — then caps at five", () => {
    const b = deriveBriefing(busy());
    expect(b?.kind).toBe("news");
    if (b?.kind !== "news") return;
    expect(BRIEFING_CAP).toBe(5);
    expect(b.lines.map((l) => l.id)).toEqual(["awaiting", "breakers", "exhausted", "closes", "landed"]);
    expect(b.overflow.map((l) => l.id)).toEqual(["directions-done", "runs"]);
  });

  it("counts only what happened after the anchor, with the predicate spelled out", () => {
    const b = deriveBriefing(busy());
    if (b?.kind !== "news") throw new Error("expected news");
    const line = (id: string) => b.lines.concat(b.overflow).find((l) => l.id === id)!;
    expect(line("awaiting").text).toBe("2 plans wait for your approval now");
    expect(line("awaiting").current).toBe(true);
    expect(line("awaiting").predicate).toMatch(/right now/);
    // The dry-backoff rest and the 20-hour-old ceiling are not breakers since the anchor.
    expect(line("breakers").text).toBe("1 breaker tripped — branch conflict on kp");
    expect(line("exhausted").text).toBe("1 direction ran out of budget");
    // Runs 9 and 8 ended after the anchor (3 closes); run 7 ended before it.
    expect(line("closes").text).toBe("3 verified closes");
    expect(line("closes").predicate).toMatch(/adjudicated/);
    // Landings are counted by their own instant: at(1) and at(4) — not at(8), not at(9).
    expect(line("landed").text).toBe("2 lanes landed on ascent/runner");
    expect(line("directions-done").text).toBe("1 direction finished");
    expect(line("runs").text).toBe("2 runs finished (1 errored)");
    for (const l of b.lines.concat(b.overflow)) {
      expect(l.predicate.length).toBeGreaterThan(20);
      expect(l.href).toMatch(/^#ledger-/);
    }
  });

  it("links every line to the section that proves it", () => {
    const b = deriveBriefing(busy());
    if (b?.kind !== "news") throw new Error("expected news");
    const href = Object.fromEntries(b.lines.concat(b.overflow).map((l) => [l.id, l.href]));
    expect(href).toEqual({
      awaiting: "#ledger-needs-you",
      breakers: "#ledger-needs-you",
      exhausted: "#ledger-directions",
      closes: "#ledger-chronicle",
      landed: "#ledger-runner",
      "directions-done": "#ledger-directions",
      runs: "#ledger-chronicle",
    });
  });

  it("says a pause in force NOW when no breaker event falls after the anchor", () => {
    const runner = runnerDrive({ phase: "paused", pausedReason: "spend-ceiling", repoState: [repoState("acme/kp", { paused: "repo-failures" }), repoState("acme/web", { paused: "dry-backoff" })] });
    const b = deriveBriefing(input({ runner, lastRunner: runner }));
    if (b?.kind !== "news") throw new Error("expected news");
    expect(b.lines).toEqual([expect.objectContaining({ id: "paused-now", current: true, text: "Paused now: the runner is paused, 1 repository paused" })]);
  });
});

describe("deriveBriefing — the window and its honesty", () => {
  it("falls back to the last 24 hours with no anchor, and says so", () => {
    const b = deriveBriefing(input({ seenAt: null, runs: [chronicleRun(3, { endedAt: at(20) }), chronicleRun(2, { startedAt: at(30), endedAt: at(26) })] }));
    if (b?.kind !== "news") throw new Error("expected news");
    expect(b.window).toBe("in the last 24 hours");
    expect(b.lines[0]!.text).toBe("1 run finished");
    expect(b.lines[0]!.predicate).toMatch(/in the last 24 hours/);
  });

  it("names the anchor window when there is one", () => {
    const b = deriveBriefing(input({ runs: [chronicleRun(3)] }));
    expect(b?.kind === "news" && b.window).toBe("since you last looked");
  });

  it("prints a lower bound when the loaded page does not reach back to the anchor", () => {
    const runs = Array.from({ length: 20 }, (_, i) => chronicleRun(40 - i, { verifiedCloses: 1, startedAt: at(1), endedAt: at(0.5) }));
    const b = deriveBriefing(input({ runs, runsHasMore: true }));
    if (b?.kind !== "news") throw new Error("expected news");
    const runsLine = b.lines.find((l) => l.id === "runs")!;
    expect(runsLine.text).toBe("20+ runs finished");
    expect(runsLine.predicate).toMatch(/lower bound/);
    expect(b.lines.find((l) => l.id === "closes")!.text).toBe("20+ verified closes");
  });

  it("does NOT claim a bound when the page already reaches back past the anchor", () => {
    const runs = [chronicleRun(5), chronicleRun(4, { startedAt: at(12), endedAt: at(11) })];
    const b = deriveBriefing(input({ runs, runsHasMore: true }));
    expect(b?.kind === "news" && b.lines[0]!.text).toBe("1 run finished");
  });
});

describe("deriveBriefing — silence and failure", () => {
  it("renders NO card when nothing happened (never 'nothing happened')", () => {
    expect(deriveBriefing(input())).toBeNull();
    expect(deriveBriefing(input({ runs: [chronicleRun(1, { startedAt: at(30), endedAt: at(29) })] }))).toBeNull();
  });

  it("is an error naming the read, never silence, when a read it depends on failed", () => {
    expect(deriveBriefing(input({ failed: ["runs"], runs: null }))).toEqual({ kind: "error", missing: ["runs"] });
    expect(deriveBriefing(input({ failed: ["anchor"] }))).toEqual({ kind: "error", missing: ["anchor"] });
    expect(deriveBriefing(input({ pending: null }))).toEqual({ kind: "error", missing: ["plans"] });
    expect(deriveBriefing(input({ failed: ["drives", "directions"], directions: null }))).toEqual({ kind: "error", missing: ["drives", "directions"] });
  });

  it("does not fail on a read it is not derived from", () => {
    expect(deriveBriefing(input({ failed: ["lessons"] }))).toBeNull();
  });
});
