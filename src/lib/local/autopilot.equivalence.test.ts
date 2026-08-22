// NAMED REGRESSION: the single-repo autopilot must behave the same after being reduced to a shim
// over the loop engine.
//
// `/api/org/local/autopilot` is a shipped surface with a shipped response shape, and the war-room
// band polls it. Re-implementing its cycle inside a general engine is exactly the kind of change that
// preserves the happy path and quietly loses a field, a branch name, or the early stop. So this file
// asserts the OBSERVABLE contract of the old module, one property at a time:
//
//   • the AutopilotJob shape and every field's meaning (phase / cycle / branch / log / closedIds /
//     commits / error / stopRequested);
//   • the branch stays `ascent/autopilot-<stamp>` — NOT the engine's `ascent/loop-…` — because an
//     operator's review habit and any local tooling key off that prefix;
//   • cycles accumulate commits and closed ids across the run, on ONE branch;
//   • a cycle with no commits and no closed rows ends the run early;
//   • stop is cooperative and lands the job in `stopped`.
//
// The agent and the rescan are fakes; nothing here spawns a process or opens a database.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Run = { id: string; orgId: string; phase: string; repos: string[]; concurrency: number; maxCycles: number; cycle: number; curated: boolean; startedAt: string; endedAt: string | null; error: string | null; createdAt: string; createdBy: string | null };
type Lane = { id: string; runId: string; repoFullName: string; cycle: number; phase: string; branch: string | null; batchIds: string[]; closedIds: string[]; commits: number; beforeScanId: string | null; afterScanId: string | null; stage: string | null; log: string[]; error: string | null; startedAt: string | null; endedAt: string | null };

const db = { runs: [] as Run[], lanes: [] as Lane[], seq: 0 };

vi.mock("@/lib/db/loop-runs", () => ({
  LOOP_CONCURRENCY_CAP: 4,
  LOOP_DEFAULT_CONCURRENCY: 2,
  LOOP_MAX_CYCLES_CAP: 5,
  LANE_LOG_LINES: 200,
  createLoopRun: vi.fn(async (input: { repos: string[]; concurrency?: number; maxCycles?: number; curated?: boolean }) => {
    const run: Run = {
      id: `run${++db.seq}`, orgId: "org1", phase: "running", repos: input.repos,
      concurrency: input.concurrency ?? 2, maxCycles: input.maxCycles ?? 3, cycle: 0,
      curated: input.curated === true, startedAt: new Date().toISOString(), endedAt: null,
      error: null, createdAt: new Date().toISOString(), createdBy: null,
    };
    db.runs.push(run);
    return run;
  }),
  getLoopRun: vi.fn(async (id: string) => db.runs.find((r) => r.id === id) ?? null),
  getActiveLoopRun: vi.fn(async () => db.runs.find((r) => !r.endedAt) ?? null),
  listLoopRuns: vi.fn(async (_org: string, limit = 20) =>
    [...db.runs].reverse().slice(0, limit).map((r) => ({ id: r.id, phase: r.phase, repos: r.repos, cycle: r.cycle, maxCycles: r.maxCycles, startedAt: r.startedAt, endedAt: r.endedAt, lift: null })),
  ),
  markStaleRunsStopped: vi.fn(async () => 0),
  updateLoopRun: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const run = db.runs.find((r) => r.id === id);
    if (!run) return null;
    if (patch.phase) run.phase = patch.phase as string;
    if (patch.cycle != null) run.cycle = patch.cycle as number;
    if (patch.error !== undefined) run.error = patch.error as string | null;
    if (patch.endedAt !== undefined) run.endedAt = patch.endedAt ? new Date(patch.endedAt as Date).toISOString() : null;
    return run;
  }),
  upsertLane: vi.fn(async (key: { runId: string; repoFullName: string; cycle: number }) => {
    const found = db.lanes.find((l) => l.runId === key.runId && l.repoFullName === key.repoFullName && l.cycle === key.cycle);
    if (found) return found;
    const lane: Lane = { id: `lane${++db.seq}`, ...key, phase: "queued", branch: null, batchIds: [], closedIds: [], commits: 0, beforeScanId: null, afterScanId: null, stage: null, log: [], error: null, startedAt: null, endedAt: null };
    db.lanes.push(lane);
    return lane;
  }),
  getLane: vi.fn(async (id: string) => db.lanes.find((l) => l.id === id) ?? null),
  listLanes: vi.fn(async (runId: string) => db.lanes.filter((l) => l.runId === runId)),
  updateLane: vi.fn(async (id: string, patch: Record<string, unknown>) => {
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

vi.mock("@/lib/env", () => ({ selfHosted: () => true, envBool: () => true }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => true, runClaudeAgent: vi.fn() }));
vi.mock("@/lib/local/pairing", () => ({ verifyLocalPath: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/db", () => ({ getRepoLocalPath: vi.fn(async () => "/paired/acme/web"), persistScanReport: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: () => ({ organization: { findUnique: async () => ({ slug: "acme" }) } }), isDbConfigured: () => true }));
vi.mock("@/lib/local/loop-worktree", () => ({
  runStamp: () => "202608221000",
  branchNameFor: (repo: string, stamp: string) => `ascent/loop-${stamp}-${repo.replace("/", "-")}`,
  createLoopWorktree: vi.fn(async (path: string, repo: string, stamp: string, branchFor?: (r: string, s: string) => string) => ({
    dir: "/tmp/wt", branch: branchFor ? branchFor(repo, stamp) : `ascent/loop-${stamp}`, pairedPath: path,
  })),
  removeLoopWorktree: vi.fn(async () => {}),
}));
const git = { commits: 1 };
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_cwd: string, args: readonly string[]) => ({ ok: true, stdout: args[0] === "rev-list" ? String(git.commits) : "headsha", stderr: "" })),
}));
vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));

import { MAX_CYCLES_CAP, getAutopilotJob, requestAutopilotStop, startAutopilot, toAutopilotJob } from "@/lib/local/autopilot";
import { isLoopRunLive } from "@/lib/local/loop-engine";
import type { LaneDeps } from "@/lib/local/loop-lane";

const REPO = "acme/web";
const item = (id: string) => ({ id, repo: REPO, title: id, dimId: "D1", dimLabel: "D1", impact: "high", effort: "low", rationale: "", explore: "", projectedPoints: 3 });

let closeSeq = 0;
function deps(over: Partial<LaneDeps> = {}): Partial<LaneDeps> {
  return {
    openBatch: (async () => [item(`rec${++closeSeq}`)]) as unknown as LaneDeps["openBatch"],
    runAgent: (async () => ({ ok: true, summary: "fixed it\nsecond line" })) as unknown as LaneDeps["runAgent"],
    rescan: (async () => ({ scanId: `scan${closeSeq}`, closedIds: [`rec${closeSeq}`] })) as unknown as LaneDeps["rescan"],
    ...over,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 2000 && db.runs.some((r) => isLoopRunLive(r.id)); i += 1) await new Promise((r) => setTimeout(r, 1));
}

beforeEach(() => {
  db.runs = [];
  db.lanes = [];
  db.seq = 0;
  closeSeq = 0;
  git.commits = 1;
});

describe("autopilot shim — the shipped job contract", () => {
  it("startAutopilot returns the legacy AutopilotJob shape", async () => {
    const job = await startAutopilot({ org: "acme", repo: REPO, path: "/paired/acme/web", maxCycles: 1, deps: deps() });
    expect(Object.keys(job).sort()).toEqual(
      ["branch", "closedIds", "commits", "cycle", "endedAt", "error", "log", "maxCycles", "org", "phase", "repo", "startedAt", "stopRequested"].sort(),
    );
    expect(job.org).toBe("acme");
    expect(job.repo).toBe(REPO);
    await settle();
  });

  it("keeps the historical `ascent/autopilot-<stamp>` branch, not the engine's loop- prefix", async () => {
    await startAutopilot({ org: "acme", repo: REPO, maxCycles: 1, deps: deps() });
    await settle();
    const job = await getAutopilotJob("acme");
    expect(job!.branch).toBe("ascent/autopilot-202608221000");
    expect(job!.branch).not.toMatch(/^ascent\/loop-/);
  });

  it("accumulates commits and closed ids across cycles on one branch", async () => {
    await startAutopilot({ org: "acme", repo: REPO, maxCycles: 3, deps: deps() });
    await settle();
    const job = await getAutopilotJob("acme");
    expect(job!.phase).toBe("done");
    expect(job!.cycle).toBe(3);
    expect(job!.commits).toBe(3); // one per cycle
    expect(job!.closedIds).toEqual(["rec1", "rec2", "rec3"]);
    expect(new Set(db.lanes.map((l) => l.branch)).size).toBe(1);
    expect(job!.log.some((l) => l.includes("Agent finished: fixed it"))).toBe(true);
    expect(job!.error).toBeNull();
  });

  it("ends early when a cycle produced no commits and closed nothing", async () => {
    git.commits = 0;
    await startAutopilot({
      org: "acme",
      repo: REPO,
      maxCycles: 5,
      deps: deps({ rescan: (async () => ({ scanId: null, closedIds: [] })) as unknown as LaneDeps["rescan"] }),
    });
    await settle();
    const job = await getAutopilotJob("acme");
    expect(job!.cycle).toBe(1); // stopped after the stalled cycle rather than re-asking
    expect(job!.phase).toBe("done");
    expect(job!.commits).toBe(0);
    expect(job!.closedIds).toEqual([]);
  });

  it("a stopped run reads as `stopped`, with stopRequested set", async () => {
    await startAutopilot({
      org: "acme",
      repo: REPO,
      maxCycles: 5,
      deps: deps({
        runAgent: (async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { ok: true, summary: "ok" };
        }) as unknown as LaneDeps["runAgent"],
      }),
    });
    expect(await requestAutopilotStop("acme")).toBe(true);
    await settle();
    const job = await getAutopilotJob("acme");
    expect(job!.phase).toBe("stopped");
    expect(job!.stopRequested).toBe(true);
    expect(job!.endedAt).not.toBeNull();
  });

  it("requestAutopilotStop is false when nothing is running", async () => {
    expect(await requestAutopilotStop("acme")).toBe(false);
  });

  it("getAutopilotJob is null before anything ran, and the last run afterwards", async () => {
    expect(await getAutopilotJob("acme")).toBeNull();
    await startAutopilot({ org: "acme", repo: REPO, maxCycles: 1, deps: deps() });
    await settle();
    expect((await getAutopilotJob("acme"))!.repo).toBe(REPO);
  });

  it("keeps the historical cycle cap", () => {
    expect(MAX_CYCLES_CAP).toBe(5);
  });
});

describe("toAutopilotJob — the phase projection", () => {
  const run = (over: Partial<Run> = {}): Run => ({
    id: "r", orgId: "o", phase: "running", repos: [REPO], concurrency: 1, maxCycles: 3, cycle: 1,
    curated: false, startedAt: "2026-08-22T10:00:00.000Z", endedAt: null, error: null,
    createdAt: "2026-08-22T10:00:00.000Z", createdBy: null, ...over,
  });
  const lane = (over: Partial<Lane> = {}): Lane => ({
    id: "l", runId: "r", repoFullName: REPO, cycle: 1, phase: "queued", branch: null, batchIds: [],
    closedIds: [], commits: 0, beforeScanId: null, afterScanId: null, stage: null, log: [],
    error: null, startedAt: null, endedAt: null, ...over,
  });
  const project = (r: Partial<Run>, lanes: Partial<Lane>[]) =>
    toAutopilotJob("acme", run(r) as never, lanes.map((l) => lane(l)) as never).phase;

  it("maps a live run through its newest lane", () => {
    expect(project({}, [])).toBe("starting");
    expect(project({}, [{ phase: "queued" }])).toBe("starting");
    expect(project({}, [{ phase: "dispatching" }])).toBe("dispatching");
    expect(project({}, [{ phase: "rescanning" }])).toBe("rescanning");
    expect(project({}, [{ phase: "error" }])).toBe("error");
  });

  it("a terminal run phase wins over whatever the lane last said", () => {
    expect(project({ phase: "done" }, [{ phase: "dispatching" }])).toBe("done");
    expect(project({ phase: "stopped" }, [{ phase: "rescanning" }])).toBe("stopped");
    expect(project({ phase: "error" }, [{ phase: "done" }])).toBe("error");
  });

  it("reads the newest cycle's lane, not the first", () => {
    expect(project({ cycle: 2 }, [{ cycle: 1, phase: "done" }, { cycle: 2, phase: "dispatching" }])).toBe("dispatching");
  });
});
