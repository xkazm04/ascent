// A LANE UNDER ITS OWN DEADLINE — what happens when a stage never comes back.
//
// The pure mechanics are in lane-watchdog.test.ts. These cases pin the CONSEQUENCES inside a real
// cycle: the deadline is the one derived from the run's parameters (raise the agent cap and the lane
// survives past the old ceiling), a stage that never settles ends the cycle rather than the run, the
// stage that was in flight lands on the row, the claimed batch is released exactly as on any other
// failure — and a normal fast cycle is untouched, with no timer left behind it.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const patches: Record<string, unknown>[] = [];
const released: string[] = [];

vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[]) => {
    released.push(...ids);
    return ids.length;
  }),
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
  recordLoopLessons: vi.fn(async () => []),
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

// The guard is machinery the lane owns rather than an injected dep, so it is mocked at the module
// seam — and its result run is the stage the campaign evidence actually died in.
const guard = vi.hoisted(() => ({ resultNeverSettles: false }));
vi.mock("@/lib/local/lane-guard", () => ({
  verifyBaseline: vi.fn(async () => ({
    resolved: { command: "npm test", source: "package.json", rung: "primary" },
    passed: true,
    note: null,
    narrowedFrom: null,
    triedNarrowed: [],
  })),
  verifyResult: vi.fn(() =>
    guard.resultNeverSettles
      ? new Promise(() => {})
      : Promise.resolve({ verdict: "verified", command: "npm test", rung: "primary", note: "Verified.", reject: false }),
  ),
  verifyRejectionLesson: () => "lesson",
  forgetVerifyBaseline: vi.fn(),
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { laneDeadlineMs } from "@/lib/local/lane-watchdog";

/** The fixture the loop had no answer for. */
const never = <T,>(): Promise<T> => new Promise<T>(() => {});

const batchItem = (id: string) => ({
  id, repo: "o/r", title: "t", dimId: "D2", dimLabel: "Tests",
  impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5,
});

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;

/** A one-minute session cap (the band's floor) keeps the derived ceiling small enough to state. */
const SESSION_MS = 60_000;
const VERIFY_MS = 600_000;

const deps = (over: Partial<LaneDeps> = {}): Partial<LaneDeps> => ({
  runAgent: vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - did it" })) as never,
  commitWork: vi.fn(async () => ({ committed: true, files: 1, resolved: ["a"], summary: "committed" })) as never,
  rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] })),
  openBatch: vi.fn(async () => [batchItem("a")]),
  loadBrief: vi.fn(async () => null) as never,
  readReport: vi.fn(async () => null) as never,
  loadPair: vi.fn(async () => null),
  summarize: vi.fn(async (l) => l),
  priorBaselines: vi.fn(async () => []),
  ...over,
});

const run = (over: Partial<Parameters<typeof runLane>[0]> = {}, over_deps: Partial<LaneDeps> = {}) =>
  runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 3, worktree: wt, batch: null,
    agent: { timeoutMs: SESSION_MS },
    verify: { enabled: true, timeoutMs: VERIFY_MS },
    deps: deps(over_deps),
    ...over,
  });

const derived = (agentMs: number) => laneDeadlineMs({ agentMs, verifyMs: VERIFY_MS, verifyEnabled: true });
const terminal = () => [...patches].reverse().find((p) => p.phase === "error" || p.phase === "done");

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  released.length = 0;
  guard.resultNeverSettles = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a stage whose promise never settles", () => {
  it("force-fails the cycle at the deadline and hands the run a result to carry on with", async () => {
    vi.useFakeTimers();
    const p = run({}, { runAgent: (() => never()) as never });
    let done = false;
    void p.then(() => {
      done = true;
    });

    // One millisecond short of the ceiling the run's own parameters imply: still working.
    await vi.advanceTimersByTimeAsync(derived(SESSION_MS) - 1);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    const res = await p;
    // A RESULT, not a throw and not a hang — the engine drops this repo and drives the next lane.
    expect(res.progressed).toBe(false);
    expect(res.error).toContain("FORCE-FAILED");
    expect(res.error).toContain("the agent session");
  });

  it("RECORDS THE STAGE that was in flight, so the sheet can say where the cycle died", async () => {
    vi.useFakeTimers();
    guard.resultNeverSettles = true;
    const p = run();
    await vi.advanceTimersByTimeAsync(derived(SESSION_MS) + 1);
    const res = await p;
    const end = terminal();
    expect(end?.phase).toBe("error");
    expect(end?.stage).toBe("verify"); // the guard's result run — run cbe04a35's own stage
    expect(String(end?.error)).toContain("verifying the session's result");
    expect(res.error).toContain("Cycle 3");
  });

  it("is not swallowed by the RESCAN's own catch — a deadline there ends the lane, not the scan", async () => {
    vi.useFakeTimers();
    const p = run({}, { rescan: (() => never()) as never });
    await vi.advanceTimersByTimeAsync(derived(SESSION_MS) + 1);
    await p;
    const end = terminal();
    expect(end?.phase).toBe("error");
    expect(end?.stage).toBe("rescan");
  });

  it("still cleans up: the claimed batch is released on the force-fail path", async () => {
    vi.useFakeTimers();
    const p = run({}, { runAgent: (() => never()) as never });
    await vi.advanceTimersByTimeAsync(derived(SESSION_MS) + 1);
    await p;
    // Same release every other failed lane gets — a cut lane must not leave zombie in_progress rows.
    expect(released).toEqual(["a"]);
    expect(terminal()?.endedAt).toBeInstanceOf(Date);
  });
});

describe("the deadline is DERIVED, not a fixed knob", () => {
  it("raising the run's agent cap raises the lane's ceiling by the same amount", async () => {
    vi.useFakeTimers();
    const raised = 3_600_000; // 60 min instead of 1
    const p = run({ agent: { timeoutMs: raised } }, { runAgent: (() => never()) as never });
    let done = false;
    void p.then(() => {
      done = true;
    });

    // Past the ceiling a one-minute session would have had — and this lane is still working.
    await vi.advanceTimersByTimeAsync(derived(SESSION_MS) + 60_000);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(derived(raised) - derived(SESSION_MS));
    await p;
    expect(done).toBe(true);
  });
});

describe("a normal fast cycle", () => {
  it("behaves exactly as it did, and leaves no timer armed", async () => {
    vi.useFakeTimers();
    const res = await run();
    // `scan` is the reading this cycle took, handed up so a run under `"run"` cadence can settle its
    // earlier deferred cycles against it instead of paying for a second scan of the same tree. Under
    // the default `"cycle"` cadence — which is this fixture — nothing reads it and the verdict fields
    // below are the ones that matter.
    expect(res).toEqual({
      laneId: "lane-1",
      progressed: true,
      commits: 1,
      closed: 1,
      error: null,
      scan: { scanId: "scan-after", closedIds: ["a"] },
    });
    const end = terminal();
    expect(end?.phase).toBe("done");
    expect(end?.stage).toBeNull();
    // The watchdog is one timer, armed lazily and disposed on the way out. A cycle that finishes
    // leaves the timer table exactly as it found it — there is nothing extra to observe.
    expect(vi.getTimerCount()).toBe(0);
  });
});
