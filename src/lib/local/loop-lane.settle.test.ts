// THE DEFERRED SETTLE AND THE LANE'S TAIL ENDS (challenge-2026-09-23, card live-war-room#A).
//
//   • the run's closing rescan runs under a WATCHDOG like every other lane stage: one that never
//     settles is force-failed, every carried claim is released, and every deferred row goes terminal
//     naming the stage — before this, `settleDeferredCycles` never resolved at all;
//   • a deferred lane's log reads the same as a `"cycle"` lane's: the "Delivered:" line, the lessons
//     line and the playbooks line (the settle copy of the tail used to write none of the three);
//   • a plan-mode lane whose planner fails flushes its activity tail before its terminal row and
//     leaves no throttle timer armed behind it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = new Map<string, string[]>();
const rows: { id: string; patch: Record<string, unknown> }[] = [];
const releases: { ids: string[]; why: string }[] = [];
const order: string[] = [];

vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[], why: string) => {
    releases.push({ ids: [...ids], why });
    return ids.length;
  }),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    rows.push({ id, patch });
    if (patch.endedAt) order.push("terminal");
    return {};
  }),
  appendLaneLog: vi.fn(async (id: string, line: string) => {
    logs.set(id, [...(logs.get(id) ?? []), line]);
  }),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/lane-outcomes", () => ({ recordLaneOutcomes: vi.fn(async () => []), getActiveDeferrals: vi.fn(async () => new Set<string>()) }));
vi.mock("@/lib/db/playbooks", () => ({ stampPlaybookApplications: vi.fn(async (_o: string, _r: string, ids: string[]) => ids.length) }));
vi.mock("@/lib/db/loop-lessons", () => ({
  recordLoopLessons: vi.fn(async (_o: string, _r: string, _l: string, lessons: string[]) => lessons.map(() => ({ status: "candidate" }))),
  recordRedBaselineLesson: vi.fn(async () => null),
}));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
vi.mock("@/lib/local/lane-guard", () => ({
  verifyBaseline: vi.fn(async () => ({ resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] })),
  verifyResult: vi.fn(async () => ({ verdict: "skipped", command: null, rung: null, note: "Skipped.", reject: false })),
  verifyRejectionLesson: () => "lesson",
  forgetVerifyBaseline: vi.fn(),
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => ({ ok: true, stdout: args[0] === "rev-list" ? "1" : "", stderr: "" })),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {}, isWorkingCopyDirty: vi.fn(async () => false) }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "done" })) }));

import { runLane, settleDeferredCycles, type DeferredCycle, type LaneDeps } from "@/lib/local/loop-lane";
import { createLaneWatchdog } from "@/lib/local/lane-watchdog";
import { createLaneActivitySink } from "@/lib/local/lane-activity";

const item = (id: string, dimId: string) => ({ id, repo: "o/r", title: id, dimId, dimLabel: dimId, impact: "high", effort: "low", rationale: "", explore: "", projectedPoints: 3 });
const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;
const REPORT = { v: 1 as const, parsed: true, items: [], lessons: ["keep the gate green", "run the suite first"] };
const briefInput = {
  org: "kiro", repo: "o/r", dimIds: ["D3"],
  playbooks: [{ id: "pb-briefed", title: "Ship gate", dimId: "D3", version: 2, summary: "s", steps: ["step"] }],
  housePattern: [], memories: [], skills: [], evidence: [],
};
const quietDeps: Partial<LaneDeps> = {
  loadPair: vi.fn(async () => null),
  summarize: vi.fn(async (l) => l),
  baseRelation: vi.fn(async () => "linear" as const),
  priorBaselines: vi.fn(async () => []),
};
const deferredCycle = (laneId: string, claimedIds: string[], over: Partial<DeferredCycle> = {}): DeferredCycle => ({
  laneId, cycle: 1, kind: "backlog", beforeScanId: "scan-before", commits: 1,
  batch: claimedIds.map((id) => item(id, "D3")), claimedIds, agentClaims: [], report: null,
  briefedPlaybooks: [], practiceId: null, ...over,
});
const terminalOf = (id: string) => [...rows].reverse().find((r) => r.id === id && r.patch.endedAt)?.patch;
const has = (id: string, re: RegExp) => (logs.get(id) ?? []).some((l) => re.test(l));

beforeEach(() => {
  logs.clear();
  rows.length = 0;
  releases.length = 0;
  order.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the closing rescan runs under a watchdog", () => {
  it("a closing rescan that never settles is force-failed: claims released, rows terminal at stage 'rescan'", async () => {
    const settled = settleDeferredCycles({
      runId: "run", org: "kiro", repo: "o/r", worktree: wt,
      deferred: [deferredCycle("d1", ["a", "b"]), deferredCycle("d2", ["c"], { cycle: 2 })],
      deps: { ...quietDeps, rescan: () => new Promise(() => {}) },
      watchdog: createLaneWatchdog({ deadlineMs: 50 }),
    } as Parameters<typeof settleDeferredCycles>[0]);
    const outcome = await Promise.race([settled.then(() => "settled"), new Promise((r) => setTimeout(() => r("hung"), 1_000))]);
    expect(outcome).toBe("settled");
    expect(releases.map((r) => r.ids)).toEqual([["a", "b"], ["c"]]);
    for (const id of ["d1", "d2"]) {
      const row = terminalOf(id);
      expect(row?.stage).toBe("rescan");
      expect(String(row?.error)).toMatch(/closing rescan was force-failed/i);
    }
  });
});

describe("log parity — the cycle path and the deferred settle write the same tail", () => {
  const TAIL = [/^Delivered: /, /lesson candidate\(s\) recorded for review/, /playbook\(s\) from this lane's brief recorded as applied/];

  it("the 'cycle' path writes all three lines (the reference)", async () => {
    await runLane({
      runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
      deps: {
        ...quietDeps,
        openBatch: vi.fn(async () => [item("r1", "D3"), item("r2", "D5")]) as never,
        loadBrief: vi.fn(async () => briefInput) as never,
        readReport: vi.fn(async () => REPORT) as never,
        commitWork: vi.fn(async () => ({ committed: true, files: 1, resolved: [], summary: "committed" })) as never,
        rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["r1"] })),
      },
    });
    for (const re of TAIL) expect(has("lane-1", re), String(re)).toBe(true);
  });

  it("the deferred settle writes the same three lines", async () => {
    await settleDeferredCycles({
      runId: "run", org: "kiro", repo: "o/r", worktree: wt,
      deferred: [deferredCycle("d1", ["r1", "r2"], { batch: [item("r1", "D3"), item("r2", "D5")], report: REPORT, briefedPlaybooks: [{ id: "pb-briefed", dimId: "D3" }] })],
      deps: quietDeps,
      scan: { scanId: "scan-after", closedIds: ["r1"] },
    });
    for (const re of TAIL) expect(has("d1", re), String(re)).toBe(true);
  });
});

describe("a plan-mode lane whose planner fails", () => {
  it("flushes the activity tail before the terminal row and leaves no throttle timer armed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const written: number[] = [];
    const res = await runLane({
      runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
      runner: { plan: true, autoKeepLessons: false, installDeps: false },
      deps: {
        ...quietDeps,
        openBatch: vi.fn(async () => [item("r1", "D3")]) as never,
        loadBrief: vi.fn(async () => null) as never,
        nextDirected: vi.fn(async () => null) as never,
        activitySink: ((laneId: string) =>
          createLaneActivitySink(laneId, {
            throttleMs: 60_000,
            write: async (_id, patch) => {
              written.push(patch.activity.length);
              order.push(`activity:${patch.activity.length}`);
            },
          })) as never,
        planLane: vi.fn(async (args: { onEvent?: (e: { kind: string }) => void }) => {
          args.onEvent?.({ kind: "tool" });
          args.onEvent?.({ kind: "edit" });
          args.onEvent?.({ kind: "tool" });
          return { mode: "failed" as const, message: "The planning session failed: provider fell over" };
        }) as never,
      },
    });
    expect(res.error).toMatch(/planning session failed/);
    // The first event writes at once; the other two coalesce into the TRAILING write, which must land
    // before the lane goes terminal rather than on a timer nobody is waiting for.
    expect(written).toEqual([1, 3]);
    expect(order.indexOf("activity:3")).toBeLessThan(order.indexOf("terminal"));
    expect(vi.getTimerCount()).toBe(0);
  });
});
