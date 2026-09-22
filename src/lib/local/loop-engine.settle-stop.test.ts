// A STOP REACHES THE RUN'S CLOSING RESCAN (challenge-2026-09-23, card live-war-room#A).
//
// Under `rescanCadence: "run"` a repo's committed cycles are ruled on by ONE closing rescan, taken
// after the lane that ended the repo's run has already left `state.lanes`. That rescan used to run
// with no watchdog and nothing registered for a stop to bite on, so `armStopTeeth` found no lanes,
// armed no backstop, and a hung closing rescan left the run `running` straight through an operator's
// Stop — breaking live.md's "a run that cannot be interrupted must still reach a terminal phase".
//
// The settle now registers its watchdog under `<repo>[#arm]#settle`, so:
//   • the stop's abort force-fails the hung rescan, the carried claims go back, the run ends `stopped`;
//   • and if even the wind-down cannot finish, the backstop writes the run terminal NAMING that key.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Run = { id: string; orgId: string; phase: string; repos: string[]; targets: { repo: string; kind: string; practiceId: string | null }[]; concurrency: number; maxCycles: number; cycle: number; startedAt: string; endedAt: string | null; error: string | null; model: null; effort: null; modelPolicy: string; models: string[]; curated: boolean; createdBy: null; createdAt: string };
type Lane = { id: string; runId: string; repoFullName: string; cycle: number; phase: string; stage: string | null; error: string | null; afterScanId: string | null; closedIds: string[]; log: string[]; endedAt: string | null; model: string | null };

const db = { runs: [] as Run[], lanes: [] as Lane[], seq: 0, hangWrites: false };
const releases: string[][] = [];

vi.mock("@/lib/db/loop-runs", () => ({
  LOOP_CONCURRENCY_CAP: 4,
  LOOP_DEFAULT_CONCURRENCY: 2,
  LOOP_MAX_CYCLES_CAP: 5,
  LANE_LOG_LINES: 200,
  createLoopRun: vi.fn(async (input: { repos: string[]; maxCycles?: number }) => {
    const now = new Date().toISOString();
    const run: Run = { id: `run${++db.seq}`, orgId: "org1", phase: "running", repos: input.repos, targets: input.repos.map((r) => ({ repo: r, kind: "backlog", practiceId: null })), concurrency: 1, maxCycles: input.maxCycles ?? 3, cycle: 0, startedAt: now, endedAt: null, error: null, model: null, effort: null, modelPolicy: "single", models: [], curated: false, createdBy: null, createdAt: now };
    db.runs.push(run);
    return run;
  }),
  getLoopRun: vi.fn(async (id: string) => db.runs.find((r) => r.id === id) ?? null),
  getActiveLoopRun: vi.fn(async () => db.runs.find((r) => !r.endedAt) ?? null),
  markStaleRunsStopped: vi.fn(async () => 0),
  updateLoopRun: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const run = db.runs.find((r) => r.id === id);
    if (!run) return null;
    if (patch.phase) run.phase = patch.phase as string;
    if (patch.error !== undefined) run.error = patch.error as string | null;
    if (patch.endedAt !== undefined) run.endedAt = patch.endedAt ? new Date(patch.endedAt as Date).toISOString() : null;
    return run;
  }),
  upsertLane: vi.fn(async (key: { runId: string; repoFullName: string; cycle: number }) => {
    const found = db.lanes.find((l) => l.runId === key.runId && l.repoFullName === key.repoFullName && l.cycle === key.cycle);
    if (found) return found;
    const lane: Lane = { id: `lane${++db.seq}`, ...key, phase: "queued", stage: null, error: null, afterScanId: null, closedIds: [], log: [], endedAt: null, model: null };
    db.lanes.push(lane);
    return lane;
  }),
  getLane: vi.fn(async (id: string) => db.lanes.find((l) => l.id === id) ?? null),
  listLanes: vi.fn(async (runId: string) => db.lanes.filter((l) => l.runId === runId)),
  updateLane: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    if (db.hangWrites) return new Promise(() => {});
    const lane = db.lanes.find((l) => l.id === id);
    if (!lane) return null;
    Object.assign(lane, patch);
    if (patch.endedAt !== undefined) lane.endedAt = patch.endedAt ? new Date(patch.endedAt as Date).toISOString() : null;
    return lane;
  }),
  appendLaneLog: vi.fn(async (id: string, line: string) => {
    db.lanes.find((l) => l.id === id)?.log.push(line);
  }),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[]) => {
    releases.push([...ids]);
    return ids.length;
  }),
}));
vi.mock("@/lib/env", () => ({ selfHosted: () => true, envBool: () => true }));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => true, runClaudeAgent: vi.fn(), DEFAULT_AGENT_MODEL: "sonnet", resolveAgentConfig: () => ({ model: "sonnet", effort: null }) }));
vi.mock("@/lib/local/pairing", () => ({ verifyLocalPath: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/db", () => ({ getRepoLocalPath: vi.fn(async (_o: string, repo: string) => `/paired/${repo}`), persistScanReport: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: () => ({ organization: { findUnique: async () => ({ slug: "acme" }) } }), isDbConfigured: () => true }));
vi.mock("@/lib/local/loop-worktree", () => ({
  runStamp: () => "202609230000",
  branchNameFor: (repo: string, stamp: string) => `ascent/loop-${stamp}-${repo.replace("/", "-")}`,
  createLoopWorktree: vi.fn(async (path: string, repo: string, stamp: string) => ({ dir: `/tmp/wt-${repo.replace("/", "-")}`, branch: `ascent/loop-${stamp}-${repo.replace("/", "-")}`, pairedPath: path, linkedDeps: [], depNotes: [] })),
  removeLoopWorktree: vi.fn(async () => {}),
  takeDepNotes: () => [],
}));
// Cycle 1 commits one; cycle 2 commits nothing — so cycle 1 defers and cycle 2's drop-out owes it a reading.
let revLists = 0;
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_cwd: string, args: readonly string[]) => ({ ok: true, stdout: args[0] === "rev-list" ? String(++revLists <= 1 ? 1 : 0) : "", stderr: "" })),
}));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/db/lane-outcomes", () => ({ getActiveDeferrals: vi.fn(async () => new Set<string>()), recordLaneOutcomes: vi.fn(async () => []) }));
vi.mock("@/lib/db/playbooks", () => ({ stampPlaybookApplications: vi.fn(async () => 0) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));

import { isLoopRunLive, startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
import { BACKLOG_LANE } from "@/lib/local/lane-kind";
import type { LaneDeps } from "@/lib/local/loop-lane";

const item = (id: string, repo: string) => ({ id, repo, title: id, dimId: "D1", dimLabel: "D1", impact: "high", effort: "low", rationale: "", explore: "", projectedPoints: 3 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deps(rescan: LaneDeps["rescan"]): Partial<LaneDeps> {
  return {
    openBatch: vi.fn(async (_org: string, repo: string) => [item(`rec-${repo}`, repo)]) as unknown as LaneDeps["openBatch"],
    laneKind: vi.fn(async () => BACKLOG_LANE),
    runAgent: vi.fn(async () => ({ ok: true, summary: "did the thing" })) as never,
    commitWork: vi.fn(async () => ({ committed: true, files: 1, resolved: [], summary: "committed" })) as never,
    refreshCheckout: vi.fn(async () => ({ scanId: null })) as unknown as LaneDeps["refreshCheckout"],
    latestScanAt: vi.fn(async () => null) as unknown as LaneDeps["latestScanAt"],
    loadPair: vi.fn(async () => null),
    summarize: vi.fn(async (l) => l),
    rescan,
  };
}

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(2)) if (cond()) return true;
  return cond();
}

beforeEach(() => {
  db.runs = [];
  db.lanes = [];
  db.seq = 0;
  db.hangWrites = false;
  releases.length = 0;
  revLists = 0;
});

describe("stopLoopRun during a hung closing rescan", () => {
  it("the stop force-fails the closing rescan: the run ends 'stopped' within 500 ms and the claim goes back", async () => {
    const rescan = vi.fn(() => new Promise<never>(() => {}));
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 2, rescanCadence: "run", verifyMode: "off", deps: deps(rescan as never) });
    expect(await until(() => rescan.mock.calls.length > 0, 2_000)).toBe(true);

    await stopLoopRun(run.id, { graceMs: 10, terminalMs: 10 });
    expect(await until(() => db.runs[0]!.phase === "stopped", 500)).toBe(true);
    expect(db.runs[0]!.endedAt).not.toBeNull();
    const cycle1 = db.lanes.find((l) => l.cycle === 1)!;
    expect(cycle1.stage).toBe("rescan");
    expect(String(cycle1.error)).toMatch(/closing rescan was force-failed/i);
    expect(releases).toContainEqual(["rec-acme/web"]);
    expect(await until(() => !isLoopRunLive(run.id), 500)).toBe(true);
  });

  it("a settle whose wind-down ALSO hangs is written terminal by the backstop, naming the '<repo>#settle' key", async () => {
    const rescan = vi.fn(() => {
      db.hangWrites = true; // every lane write from here on never returns, the wind-down's included
      return new Promise<never>(() => {});
    });
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 2, rescanCadence: "run", verifyMode: "off", deps: deps(rescan as never) });
    expect(await until(() => rescan.mock.calls.length > 0, 2_000)).toBe(true);

    await stopLoopRun(run.id, { graceMs: 10, terminalMs: 10 });
    expect(await until(() => db.runs[0]!.phase === "stopped", 500)).toBe(true);
    expect(db.runs[0]!.endedAt).not.toBeNull();
    expect(db.runs[0]!.error).toContain("acme/web#settle");
  });

  it("guard: a closing rescan that settles normally still ends the run 'done' with both rows adjudicated", async () => {
    const rescan = vi.fn(async () => ({ scanId: "scan-after", closedIds: ["rec-acme/web"] }));
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 2, rescanCadence: "run", verifyMode: "off", deps: deps(rescan) });
    expect(await until(() => !isLoopRunLive(run.id), 2_000)).toBe(true);
    expect(db.runs[0]!.phase).toBe("done");
    expect(db.runs[0]!.error).toBeNull();
    expect(rescan).toHaveBeenCalledTimes(1);
    const cycle1 = db.lanes.find((l) => l.cycle === 1)!;
    expect(cycle1).toMatchObject({ phase: "done", stage: null, afterScanId: "scan-after", closedIds: ["rec-acme/web"] });
    // Cycle 2's own no-commit release, and nothing from the settle: the closing reading owns cycle 1's claim.
    expect(releases).toEqual([["rec-acme/web"]]);
  });
});
