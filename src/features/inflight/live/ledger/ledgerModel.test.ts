// The ledger's words are facts about functions: the runner's one line in each state, why a plan waits,
// the chronicle's labels, badge and cursor, and the formatters that must never print an unknown as 0.

import { describe, expect, it } from "vitest";
import { appendPage, laneFlow, oldestSeq, runBadge, runLabel } from "./chronicleModel";
import { fmtAgo, fmtIn, fmtSpan, fmtUsd } from "./ledgerFormat";
import { at, chronicleRun, NOW, repoState, runnerDrive } from "./ledgerFixture";
import { heldLogCommand, needsOperator, planReason, runnerStatus } from "./ledgerModel";
import { decisionBody } from "./planDecisionModel";

describe("runnerStatus", () => {
  it("says there is no runner", () => {
    expect(runnerStatus(null, null, NOW)).toEqual({ state: "none", text: "No runner" });
  });

  it("names the run and cycle while running, and says so between runs", () => {
    const r = runnerDrive({ startedAt: at(3) });
    expect(runnerStatus(r, { id: "run-12", seq: 12, cycle: 2, maxCycles: 3, startedAt: at(1) }, NOW).text).toBe("Running since 3 h ago · run #12 · cycle 2/3");
    expect(runnerStatus(r, null, NOW).text).toBe("Running since 3 h ago · between runs");
  });

  it("names the breaker and when it lifts — or that it waits for you", () => {
    const paused = runnerDrive({ phase: "paused", pausedReason: "spend-ceiling", pausedUntil: at(-6) });
    expect(runnerStatus(paused, null, NOW)).toEqual({ state: "paused", text: "Paused — the day's spend ceiling was reached, lifts in 6 h" });
    expect(runnerStatus(runnerDrive({ phase: "paused", pausedReason: "session-limit" }), null, NOW).text).toBe(
      "Paused — the account hit its session limit until you act",
    );
  });

  it("says when the next resting repo wakes", () => {
    const idle = runnerDrive({
      phase: "idle",
      repoState: [repoState("a/x", { paused: "dry-backoff", pausedUntil: at(-4) }), repoState("a/y", { paused: "dry-backoff", pausedUntil: at(-1) })],
    });
    expect(runnerStatus(idle, null, NOW)).toEqual({ state: "idle", text: "Idle — next repo wakes in 1 h" });
    expect(runnerStatus(runnerDrive({ phase: "idle", repoState: [] }), null, NOW).text).toBe("Idle — every repo is resting");
  });
});

describe("planReason and the held command", () => {
  it.each([
    ["declared-moves", null, "moves architecture"],
    ["unreadable", null, "the plan could not be read — review the text"],
    ["undeclared-moves-in-diff", "ascent/held/p1", "the lane made a move its plan did not declare — work held on ascent/held/p1"],
  ] as const)("%s → %s", (clsReason, heldBranch, want) => {
    expect(planReason({ clsReason, heldBranch })).toBe(want);
  });

  it("lists the parked commits against the runner branch", () => {
    expect(heldLogCommand("ascent/held/p1")).toBe("git log --stat ascent/runner..ascent/held/p1");
  });

  it("counts only a pause a person must lift", () => {
    expect(needsOperator(repoState("a", { paused: "branch-conflict" }))).toBe(true);
    expect(needsOperator(repoState("a", { paused: "dry-backoff" }))).toBe(false);
    expect(needsOperator(repoState("a"))).toBe(false);
  });
});

describe("the chronicle's arithmetic", () => {
  it("labels, badges and pages by the stable number", () => {
    expect(runLabel({ seq: 4, startedAt: NOW })).toBe("#4");
    expect(runLabel({ seq: null, startedAt: NOW })).toBe("2026-09-18");
    expect(runBadge({ driveId: null }, {})).toBe("manual");
    expect(runBadge({ driveId: "d" }, { d: "continuous" })).toBe("runner");
    expect(runBadge({ driveId: "d" }, { d: "bounded" })).toBe("drive");
    expect(runBadge({ driveId: "pruned" }, {})).toBe("drive");
    expect(oldestSeq([{ seq: 9 }, { seq: null }, { seq: 4 }])).toBe(4);
    expect(oldestSeq([{ seq: null }])).toBeNull();
    expect(appendPage([chronicleRun(5), chronicleRun(4)], [chronicleRun(4), chronicleRun(3)]).map((r) => r.seq)).toEqual([5, 4, 3]);
  });

  it("counts a lane's flow from its own record, and an unrecorded proposal as unknown", () => {
    const f = laneFlow({ proposed: null, batchIds: ["a", "b"], closedIds: ["a"], landedAt: null });
    expect(f.stages.map((s) => s.value)).toEqual([null, 2, 1]);
    expect(f.stages[2]!.label).toBe("Delivered");
    expect(f.proposedTitle).toMatch(/unknown, not zero/);
  });
});

describe("formatters and the decision body", () => {
  it("prints time against the load's clock and never money it does not have", () => {
    expect(fmtSpan(90 * 60_000)).toBe("1 h 30 m");
    expect(fmtAgo(at(0.001), NOW)).toBe("just now");
    expect(fmtAgo("garbage", NOW)).toBe("at an unknown time");
    expect(fmtIn(at(1), NOW)).toBe("now");
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(42_000_000)).toBe("$0.42");
  });

  it("builds each verdict's body, refusing what the route would refuse for shape", () => {
    const f = { fence: ["src/a/"], cycles: "3", usd: "", note: "" };
    expect(decisionBody("approve", f)).toEqual({ ok: true, body: { decision: "approve", note: "", fence: ["src/a/"], budgetCycles: 3 } });
    expect(decisionBody("approve", { ...f, usd: "-1" }).ok).toBe(false);
    expect(decisionBody("approve", { ...f, cycles: "0" }).ok).toBe(false);
    expect(decisionBody("revise", f).ok).toBe(false);
    expect(decisionBody("reject", { ...f, note: " no " })).toEqual({ ok: true, body: { decision: "reject", note: "no" } });
  });
});
