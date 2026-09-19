// RESCAN CADENCE — how often a multi-cycle run pays for a full rescan.
//
// THE MEASUREMENT (docs/harness/reflection-2026-09-01.md, 19 committed cycles): agent 1203 s, rescan
// 279 s, verify 53 s, land 11 s. Seventeen per cent of every cycle went on a five-minute full rescan
// whose only consumers were the NEXT cycle's batch and the attribution pair — and the next cycle's
// batch does not need it, because a claimed row is `in_progress` and `openBatch` already excludes it.
//
// So `rescanCadence: "run"` rescans ONCE, after the last cycle the repo actually progressed in. What
// this file pins is that the saving costs nothing the rescan was load-bearing for:
//   • a 3-cycle run rescans exactly once, at the end;
//   • every cycle's pair still spans the run's opening `before` → that one final `after`;
//   • a run that DROPS OUT after cycle 2 still takes its reading then — the branch carries cycle 1's
//     commits, and "nothing landed in this worktree" (the no-commit guard) is simply not true of it;
//   • a run that never commits still never rescans — the guard is upstream of the cadence;
//   • and `"cycle"` — the DEFAULT — is exactly what the loop did before the parameter existed.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── in-memory stand-in for the persistence layer (the phase-machine suite's, trimmed) ────────────
type Target = { repo: string; kind: string; practiceId: string | null };
type Run = { id: string; orgId: string; phase: string; repos: string[]; targets: Target[]; concurrency: number; maxCycles: number; cycle: number; curated: boolean; model: string | null; effort: string | null; modelPolicy: string; models: string[]; startedAt: string; endedAt: string | null; error: string | null; createdAt: string; createdBy: string | null };
type Lane = { id: string; runId: string; repoFullName: string; cycle: number; executor?: string; phase: string; branch: string | null; batchIds: string[]; closedIds: string[]; commits: number; beforeScanId: string | null; afterScanId: string | null; stage: string | null; log: string[]; error: string | null; startedAt: string | null; endedAt: string | null; model: string | null; abPairKey: string | null };

const db = { runs: [] as Run[], lanes: [] as Lane[], seq: 0, hangWrites: false };

vi.mock("@/lib/db/loop-runs", () => ({
  LOOP_CONCURRENCY_CAP: 4,
  LOOP_DEFAULT_CONCURRENCY: 2,
  LOOP_MAX_CYCLES_CAP: 5,
  LANE_LOG_LINES: 200,
  createLoopRun: vi.fn(async (input: { orgSlug: string; repos: string[]; targets?: Target[]; concurrency?: number; maxCycles?: number; curated?: boolean; model?: string | null; effort?: string | null; modelPolicy?: string; models?: string[]; phase?: string }) => {
    const run: Run = {
      id: `run${++db.seq}`,
      orgId: "org1",
      phase: input.phase ?? "running",
      repos: input.repos,
      targets: input.targets ?? input.repos.map((r) => ({ repo: r, kind: "backlog", practiceId: null })),
      concurrency: input.concurrency ?? 2,
      maxCycles: input.maxCycles ?? 3,
      cycle: 0,
      curated: input.curated === true,
      model: input.model ?? null,
      effort: input.effort ?? null,
      modelPolicy: input.modelPolicy ?? "single",
      models: input.models ?? [],
      startedAt: new Date().toISOString(),
      endedAt: null,
      error: null,
      createdAt: new Date().toISOString(),
      createdBy: null,
    };
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
    if (patch.cycle != null) run.cycle = patch.cycle as number;
    if (patch.error !== undefined) run.error = patch.error as string | null;
    if (patch.endedAt !== undefined) run.endedAt = patch.endedAt ? new Date(patch.endedAt as Date).toISOString() : null;
    return run;
  }),
  upsertLane: vi.fn(async (key: { runId: string; repoFullName: string; cycle: number; model?: string | null; abPairKey?: string | null; executor?: string; batchIds?: string[] }) => {
    const { model = null, abPairKey = null, executor = "local", batchIds = [], ...base } = key;
    const found = db.lanes.find(
      (l) => l.runId === base.runId && l.repoFullName === base.repoFullName && l.cycle === base.cycle && (!model || l.model === model),
    );
    if (found) return found;
    const lane: Lane = { id: `lane${++db.seq}`, ...base, model, abPairKey, executor, phase: "queued", branch: null, batchIds, closedIds: [], commits: 0, beforeScanId: null, afterScanId: null, stage: null, log: [], error: null, startedAt: null, endedAt: null };
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

vi.mock("@/lib/env", () => ({ selfHosted: () => true, envBool: () => true }));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/local/agent", () => ({
  autopilotEnabled: () => true,
  runClaudeAgent: vi.fn(),
  DEFAULT_AGENT_MODEL: "sonnet",
  resolveAgentConfig: () => ({ model: "sonnet", effort: null }),
}));
vi.mock("@/lib/local/pairing", () => ({ verifyLocalPath: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/db", () => ({ getRepoLocalPath: vi.fn(async (_o: string, repo: string) => `/paired/${repo}`), persistScanReport: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: () => ({ organization: { findUnique: async () => ({ slug: "acme" }) } }), isDbConfigured: () => true }));
vi.mock("@/lib/local/loop-worktree", () => ({
  runStamp: () => "202608221000",
  branchNameFor: (repo: string, stamp: string) => `ascent/loop-${stamp}-${repo.replace("/", "-")}`,
  createLoopWorktree: vi.fn(async (path: string, repo: string, stamp: string, branchFor?: (r: string, s: string) => string) => ({
    dir: `/tmp/wt-${repo.replace("/", "-")}`,
    branch: branchFor ? branchFor(repo, stamp) : `ascent/loop-${stamp}-${repo.replace("/", "-")}`,
    pairedPath: path,
    linkedDeps: [],
    depNotes: [],
  })),
  removeLoopWorktree: vi.fn(async () => {}),
  takeDepNotes: () => [],
}));
// `byCwd` is really "per rev-list call" here: it is how a cycle is given a different commit count
// from the one before it, which is what makes a repo drop out mid-run.
const gitCommits = { n: 1, byCwd: null as ((cwd: string) => number) | null };
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (cwd: string, args: readonly string[]) => ({
    ok: true,
    stdout: args[0] === "rev-list" ? String(gitCommits.byCwd ? gitCommits.byCwd(cwd) : gitCommits.n) : "headsha",
    stderr: "",
  })),
}));
vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/db/lane-outcomes", () => ({
  getActiveDeferrals: vi.fn(async () => new Set<string>()),
  recordLaneOutcomes: vi.fn(async () => []),
}));
vi.mock("@/lib/db/playbooks", () => ({ stampPlaybookApplications: vi.fn(async () => 0) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));

import { isLoopRunLive, startLoopRun } from "@/lib/local/loop-engine";
import { BACKLOG_LANE } from "@/lib/local/lane-kind";
import type { LaneDeps } from "@/lib/local/loop-lane";

const item = (id: string, repo: string) => ({ id, repo, title: id, dimId: "D1", dimLabel: "D1", impact: "high", effort: "low", rationale: "", explore: "", projectedPoints: 3 });

/** The same "always works" deps the phase-machine suite uses; the rescan is the counted seam. */
function workingDeps(over: Partial<LaneDeps> = {}): Partial<LaneDeps> {
  return {
    openBatch: vi.fn(async (_org: string, repo: string) => [item(`rec-${repo}`, repo)]) as unknown as LaneDeps["openBatch"],
    laneKind: vi.fn(async () => BACKLOG_LANE),
    install: vi.fn(async () => ({ ok: true, written: [], skipped: [], committed: false, summary: "not used" })),
    runAgent: vi.fn(async () => ({ ok: true, summary: "did the thing" })),
    commitWork: vi.fn(async () => ({ committed: true, files: 2, resolved: [], summary: "the lane committed the agent's work" })),
    refreshCheckout: vi.fn(async () => ({ scanId: "scan-refreshed" })) as unknown as LaneDeps["refreshCheckout"],
    latestScanAt: vi.fn(async () => null) as unknown as LaneDeps["latestScanAt"],
    ...over,
  };
}

const countedRescan = () =>
  vi.fn(async ({ repo }: { repo: string }) => ({ scanId: `scan-after-${repo}`, closedIds: [`rec-${repo}`] }));

async function settle(runId: string): Promise<void> {
  for (let i = 0; i < 4000 && isLoopRunLive(runId); i += 1) await new Promise((r) => setTimeout(r, 1));
}

const lanesOf = (runId: string) => db.lanes.filter((l) => l.runId === runId).sort((a, b) => a.cycle - b.cycle);

beforeEach(() => {
  db.runs = [];
  db.lanes = [];
  db.seq = 0;
  db.hangWrites = false;
  gitCommits.n = 1;
  gitCommits.byCwd = null;
});

describe('rescanCadence: "run" — one reading per run, not one per cycle', () => {
  it("a 3-cycle run that commits every cycle rescans EXACTLY ONCE", async () => {
    const rescan = countedRescan();
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 3,
      rescanCadence: "run",
      deps: workingDeps({ rescan: rescan as unknown as LaneDeps["rescan"] }),
    });
    await settle(run.id);

    expect(db.runs[0]!.phase).toBe("done");
    expect(lanesOf(run.id)).toHaveLength(3);
    // The whole point. Under "cycle" this is 3 — three full scans, roughly nine minutes.
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("the attribution pair spans the run's FIRST before and its LAST after, on every cycle", async () => {
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 3,
      rescanCadence: "run",
      deps: workingDeps({ rescan: countedRescan() as unknown as LaneDeps["rescan"] }),
    });
    await settle(run.id);

    const lanes = lanesOf(run.id);
    for (const lane of lanes) {
      expect(lane.phase).toBe("done");
      expect(lane.beforeScanId).toBe("scan-before");
      // Cycles 1 and 2 are adjudicated by the SAME closing scan cycle 3 took — a real before/after
      // spanning the run, rather than three pairs each straddling one cycle of scanner noise.
      expect(lane.afterScanId).toBe("scan-after-acme/web");
      expect(lane.closedIds).toEqual(["rec-acme/web"]);
      expect(lane.stage).toBeNull();
    }
    // The deferral is said out loud on the cycles that took it, and never on the one that read.
    expect(lanes[0]!.log.join("\n")).toContain("Rescan deferred");
    expect(lanes[2]!.log.join("\n")).not.toContain("Rescan deferred");
  });

  it("a run that DROPS OUT after cycle 2 takes its one reading THEN", async () => {
    // Cycle 1 commits and defers; cycle 2 commits nothing, so the repo drops out. The branch still
    // carries cycle 1's work, so the reading it is owed is taken at the drop-out.
    let call = 0;
    gitCommits.byCwd = () => (++call <= 1 ? 1 : 0);
    const rescan = countedRescan();
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 3,
      rescanCadence: "run",
      deps: workingDeps({ rescan: rescan as unknown as LaneDeps["rescan"] }),
    });
    await settle(run.id);

    const lanes = lanesOf(run.id);
    expect(lanes).toHaveLength(2); // cycle 3 never ran — the repo dropped out
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(lanes[0]!.afterScanId).toBe("scan-after-acme/web");
    expect(lanes[0]!.closedIds).toEqual(["rec-acme/web"]);
  });

  it("a run that NEVER commits still never rescans — the no-commit guard is upstream of the cadence", async () => {
    gitCommits.n = 0;
    const rescan = countedRescan();
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 3,
      rescanCadence: "run",
      deps: workingDeps({ rescan: rescan as unknown as LaneDeps["rescan"] }),
    });
    await settle(run.id);

    expect(rescan).not.toHaveBeenCalled();
    expect(lanesOf(run.id)[0]!.afterScanId).toBeNull();
  });
});

describe('rescanCadence: "cycle" — the DEFAULT, unchanged', () => {
  it("an omitted cadence rescans every committing cycle, exactly as before the parameter existed", async () => {
    const rescan = countedRescan();
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 3,
      deps: workingDeps({ rescan: rescan as unknown as LaneDeps["rescan"] }),
    });
    await settle(run.id);

    expect(rescan).toHaveBeenCalledTimes(3);
    for (const lane of lanesOf(run.id)) {
      expect(lane.beforeScanId).toBe("scan-before");
      expect(lane.afterScanId).toBe("scan-after-acme/web");
      expect(lane.closedIds).toEqual(["rec-acme/web"]);
      // Nothing was ever deferred, so nothing says it was.
      expect(lane.log.join("\n")).not.toContain("Rescan deferred");
    }
  });

  it('an explicit "cycle" is the same run as an omitted one', async () => {
    const a = countedRescan();
    const b = countedRescan();
    const r1 = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 2, deps: workingDeps({ rescan: a as unknown as LaneDeps["rescan"] }) });
    await settle(r1.id);
    const shape = lanesOf(r1.id).map((l) => [l.cycle, l.beforeScanId, l.afterScanId, l.closedIds.join(",")]);
    db.runs = [];
    db.lanes = [];
    const r2 = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 2, rescanCadence: "cycle", deps: workingDeps({ rescan: b as unknown as LaneDeps["rescan"] }) });
    await settle(r2.id);
    expect(lanesOf(r2.id).map((l) => [l.cycle, l.beforeScanId, l.afterScanId, l.closedIds.join(",")])).toEqual(shape);
    expect(b.mock.calls.length).toBe(a.mock.calls.length);
  });
});
