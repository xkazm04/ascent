// A DRY LANE — the repo that ran out of recorded work, and how it gets back.
//
// THE MEASURED FAILURE. An 8-run campaign on two repos (2026-08-31): `xkazm04/systedo-case` worked in
// nearly every cycle; `xkazm04/kp` reported "No open follow-ups left for this repo — nothing to
// dispatch" in 6 of 7 runs and produced nothing at all. kp was not failing — its gaps were closed,
// its last scan raised no craft entries, and its remaining dimensions sat above the follow-up floor,
// so nothing new was generated either. And it could not recover, because the loop only rescans after
// commits: no work → no commits → no rescan → no fresh roadmap → no work, permanently.
//
// What these pin:
//   • a dry lane WITH a pairing refreshes the repository's reading — exactly once — and still ends
//     NON-PROGRESSING, so the engine's drop-out rule is untouched;
//   • a lane with work never touches the refresh seam (the ordinary path is byte-identical);
//   • the second dry lane of the same run does not refresh again (the engine's per-run claim);
//   • a repo already scanned since the run started is skipped (freshness, not a scan per cycle);
//   • a refresh that throws is logged and the lane still ends cleanly;
//   • the refresh runs under the CYCLE WATCHDOG, so a hung scan cannot park the run.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const patches: Record<string, unknown>[] = [];
const lessons: string[] = [];

vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[]) => ids.length),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    patches.push(patch);
    return {};
  }),
  appendLaneLog: vi.fn(async (_id: string, line: string) => {
    logs.push(line);
  }),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/loop-lessons", () => ({
  recordLoopLessons: vi.fn(async (_o: string, _r: string, _l: string, list: string[]) => {
    lessons.push(...list);
    return [];
  }),
  recordRedBaselineLesson: vi.fn(async () => null),
}));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: readonly string[]) => {
    if (args[0] === "rev-list") return { ok: true, stdout: "1", stderr: "" };
    if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
    return { ok: true, stdout: "sha_head", stderr: "" };
  }),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {}, isWorkingCopyDirty: vi.fn(async () => false) }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "did things" })) }));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
vi.mock("@/lib/local/lane-guard", () => ({
  verifyBaseline: vi.fn(async () => ({ resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] })),
  verifyResult: vi.fn(async () => ({ verdict: "verified", command: "npm test", rung: "primary", note: "Verified.", reject: false })),
  verifyRejectionLesson: () => "lesson",
  forgetVerifyBaseline: vi.fn(),
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));

import { runLane, type DryLaneRefresh, type LaneDeps } from "@/lib/local/loop-lane";
import { laneDeadlineMs } from "@/lib/local/lane-watchdog";

const RUN_STARTED = new Date("2026-08-31T12:00:00.000Z");
const SESSION_MS = 60_000;
const VERIFY_MS = 600_000;

const batchItem = (id: string) => ({
  id, repo: "o/r", title: "t", dimId: "D2", dimLabel: "Tests",
  impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5,
});

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;

/** The engine's per-run memo, reproduced exactly: true once per repo, false forever after. */
function permit(over: Partial<DryLaneRefresh> = {}): DryLaneRefresh {
  const spent = new Set<string>();
  return {
    pairedPath: "C:/repo",
    runStartedAt: RUN_STARTED,
    claim: () => {
      if (spent.has("o/r")) return false;
      spent.add("o/r");
      return true;
    },
    ...over,
  };
}

const refreshCheckout = vi.fn(async () => ({ scanId: "scan-fresh" }));
const latestScanAt = vi.fn(async () => null as Date | null);

const deps = (over: Partial<LaneDeps> = {}): Partial<LaneDeps> => ({
  runAgent: vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - did it" })) as never,
  commitWork: vi.fn(async () => ({ committed: true, files: 1, resolved: ["a"], summary: "committed" })) as never,
  rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] })),
  openBatch: vi.fn(async () => []),
  refreshCheckout: refreshCheckout as unknown as LaneDeps["refreshCheckout"],
  latestScanAt: latestScanAt as unknown as LaneDeps["latestScanAt"],
  loadBrief: vi.fn(async () => null) as never,
  readReport: vi.fn(async () => null) as never,
  loadPair: vi.fn(async () => null),
  summarize: vi.fn(async (l) => l),
  priorBaselines: vi.fn(async () => []),
  ...over,
});

const run = (over: Partial<Parameters<typeof runLane>[0]> = {}, over_deps: Partial<LaneDeps> = {}) =>
  runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
    agent: { timeoutMs: SESSION_MS },
    verify: { enabled: true, timeoutMs: VERIFY_MS },
    deps: deps(over_deps),
    ...over,
  });

const terminal = () => [...patches].reverse().find((p) => p.phase === "error" || p.phase === "done");
const logged = (needle: string) => logs.some((l) => l.includes(needle));

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  lessons.length = 0;
  refreshCheckout.mockClear();
  refreshCheckout.mockImplementation(async () => ({ scanId: "scan-fresh" }));
  latestScanAt.mockClear();
  latestScanAt.mockImplementation(async () => null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a lane that finds NOTHING to dispatch", () => {
  it("refreshes the repository's reading from the PAIRED CHECKOUT — once — and ends non-progressing", async () => {
    const res = await run({ refresh: permit() });

    expect(refreshCheckout).toHaveBeenCalledTimes(1);
    // THE CHECKOUT, never the worktree: the no-commits guard's reasoning is about a worktree nothing
    // landed in, and this is the repository's actual current state.
    expect(refreshCheckout.mock.calls[0]![0]).toMatchObject({ org: "kiro", repo: "o/r", dir: "C:/repo" });
    expect(logged("refreshed this repository's reading from the paired checkout")).toBe(true);

    // NON-PROGRESSING, so the engine's existing drop-out rule still applies untouched.
    expect(res).toEqual({ laneId: "lane-1", progressed: false, commits: 0, closed: 0, error: null });
    expect(terminal()).toMatchObject({ phase: "done", stage: null });
  });

  it("records a lesson saying the roadmap was stale rather than finished", async () => {
    await run({ refresh: permit() });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toContain("stale, not finished");
  });

  it("does nothing at all when no pairing was vouched for — the pre-existing behaviour, verbatim", async () => {
    const res = await run();
    expect(refreshCheckout).not.toHaveBeenCalled();
    expect(latestScanAt).not.toHaveBeenCalled();
    expect(logged("nothing to dispatch")).toBe(true);
    expect(res.progressed).toBe(false);
  });
});

describe("a lane that HAS work", () => {
  it("never touches the refresh seam — the ordinary path is byte-identical", async () => {
    const res = await run({ refresh: permit() }, { openBatch: vi.fn(async () => [batchItem("a")]) });
    expect(res.progressed).toBe(true);
    expect(refreshCheckout).not.toHaveBeenCalled();
    expect(latestScanAt).not.toHaveBeenCalled();
  });
});

describe("the once-per-repo-per-run bound", () => {
  it("a SECOND dry lane in the same run does not refresh again", async () => {
    const shared = permit();
    await run({ refresh: shared, cycle: 1 });
    expect(refreshCheckout).toHaveBeenCalledTimes(1);

    logs.length = 0;
    await run({ refresh: shared, cycle: 2 });
    // Still one: the run's claim is spent, so a dedup'd refresh (which would leave the freshness
    // timestamp unmoved) cannot buy a second scan either.
    expect(refreshCheckout).toHaveBeenCalledTimes(1);
    expect(logged("already refreshed this repository's reading")).toBe(true);
  });

  it("skips a repo whose reading is already NEWER than the run started", async () => {
    latestScanAt.mockImplementation(async () => new Date(RUN_STARTED.getTime() + 60_000));
    const res = await run({ refresh: permit() });
    expect(refreshCheckout).not.toHaveBeenCalled();
    expect(logged("the reading is already current")).toBe(true);
    expect(res.progressed).toBe(false);
    expect(terminal()).toMatchObject({ phase: "done" });
  });

  it("still refreshes when the newest reading PREDATES the run", async () => {
    latestScanAt.mockImplementation(async () => new Date(RUN_STARTED.getTime() - 60_000));
    await run({ refresh: permit() });
    expect(refreshCheckout).toHaveBeenCalledTimes(1);
  });
});

describe("a refresh that fails", () => {
  it("is logged and the lane still ends cleanly — never a failed run", async () => {
    refreshCheckout.mockImplementation(async () => {
      throw new Error("the scan provider was unreachable");
    });
    const res = await run({ refresh: permit() });
    expect(logged("the refresh of this repository's reading failed")).toBe(true);
    expect(logged("the scan provider was unreachable")).toBe(true);
    expect(res).toEqual({ laneId: "lane-1", progressed: false, commits: 0, closed: 0, error: null });
    expect(terminal()).toMatchObject({ phase: "done" });
  });

  it("a freshness read that throws does not stop the refresh — an unreadable timestamp is not 'current'", async () => {
    latestScanAt.mockImplementation(async () => {
      throw new Error("db down");
    });
    await run({ refresh: permit() });
    expect(refreshCheckout).toHaveBeenCalledTimes(1);
  });
});

describe("the refresh runs under the CYCLE WATCHDOG", () => {
  it("a scan that never settles is orphaned at the lane's deadline instead of parking the run", async () => {
    vi.useFakeTimers();
    refreshCheckout.mockImplementation((() => new Promise(() => {})) as never);
    const p = run({ refresh: permit() });
    let done = false;
    void p.then(() => {
      done = true;
    });

    const deadline = laneDeadlineMs({ agentMs: SESSION_MS, verifyMs: VERIFY_MS, verifyEnabled: true });
    await vi.advanceTimersByTimeAsync(deadline - 1);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    const res = await p;
    // The lane ENDS — a result the engine can carry on from, not a hang and not a throw.
    expect(res.progressed).toBe(false);
    expect(res.error).toBeNull();
    expect(logged("the refresh of this repository's reading failed")).toBe(true);
    expect(terminal()).toMatchObject({ phase: "done" });
    // One timer, disposed on the way out.
    expect(vi.getTimerCount()).toBe(0);
  });
});
