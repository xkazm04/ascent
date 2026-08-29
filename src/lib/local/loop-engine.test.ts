// The loop engine's PHASE MACHINE, with the two side-effecting primitives (the local agent and the
// rescan) replaced by fakes. Nothing here spawns a process, touches git, or opens a database.
//
// What it pins:
//   • the run's phase transitions (running → done / stopped / error) and the cycle counter;
//   • per-lane phases: queued → dispatching → rescanning → done, and error on a failure;
//   • that ONE lane's failure does not take the run or its sibling lanes down;
//   • the early-stop rule, now applied PER LANE: a repo that produced neither a commit nor a closed
//     row drops out of the next cycle while the others keep cycling;
//   • bounded parallelism — never more lanes in flight than `concurrency`.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── in-memory stand-in for the persistence layer ─────────────────────────────────────────────────
type Target = { repo: string; kind: string; practiceId: string | null };
type Run = { id: string; orgId: string; phase: string; repos: string[]; targets: Target[]; concurrency: number; maxCycles: number; cycle: number; curated: boolean; model: string | null; effort: string | null; startedAt: string; endedAt: string | null; error: string | null; createdAt: string; createdBy: string | null };
type Lane = { id: string; runId: string; repoFullName: string; cycle: number; phase: string; branch: string | null; batchIds: string[]; closedIds: string[]; commits: number; beforeScanId: string | null; afterScanId: string | null; stage: string | null; log: string[]; error: string | null; startedAt: string | null; endedAt: string | null };

const db = { runs: [] as Run[], lanes: [] as Lane[], seq: 0 };

vi.mock("@/lib/db/loop-runs", () => ({
  LOOP_CONCURRENCY_CAP: 4,
  LOOP_DEFAULT_CONCURRENCY: 2,
  LOOP_MAX_CYCLES_CAP: 5,
  LANE_LOG_LINES: 200,
  createLoopRun: vi.fn(async (input: { orgSlug: string; repos: string[]; targets?: Target[]; concurrency?: number; maxCycles?: number; curated?: boolean; model?: string | null; effort?: string | null }) => {
    const run: Run = {
      id: `run${++db.seq}`,
      orgId: "org1",
      phase: "running",
      repos: input.repos,
      // The row records the ARMED kinds — the ledger reads them back long after the run ended.
      targets: input.targets ?? input.repos.map((r) => ({ repo: r, kind: "backlog", practiceId: null })),
      concurrency: input.concurrency ?? 2,
      maxCycles: input.maxCycles ?? 3,
      cycle: 0,
      curated: input.curated === true,
      model: input.model ?? null,
      effort: input.effort ?? null,
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
// resolveAgentConfig is NOT stubbed to a constant: the engine's job is to resolve the operator's pick
// against the deployment env exactly once and persist the answer, so the real resolver runs here.
vi.mock("@/lib/local/agent", async () => {
  const options = await import("@/lib/local/agent-options");
  return {
    autopilotEnabled: () => true,
    runClaudeAgent: vi.fn(),
    DEFAULT_AGENT_MODEL: "sonnet",
    resolveAgentConfig: (choice: { model?: string | null; effort?: string | null } | null | undefined) => ({
      model: options.normalizeAgentModel(choice?.model) ?? (process.env.CLAUDE_MODEL?.trim() || "sonnet"),
      effort: options.normalizeAgentEffort(choice?.effort) ?? options.normalizeAgentEffort(process.env.ASCENT_AGENT_EFFORT?.trim()),
    }),
  };
});
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
  })),
  removeLoopWorktree: vi.fn(async () => {}),
}));
// git is only used for HEAD bookkeeping inside the lane; both calls are shaped as successes.
const gitCommits = { n: 1 };
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_cwd: string, args: readonly string[]) => ({
    ok: true,
    stdout: args[0] === "rev-list" ? String(gitCommits.n) : "headsha",
    stderr: "",
  })),
}));
vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));

import { isLoopRunLive, startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
import { BACKLOG_LANE, type LaneKindProposal } from "@/lib/local/lane-kind";
import type { LaneDeps } from "@/lib/local/loop-lane";

const item = (id: string, repo: string) => ({ id, repo, title: id, dimId: "D1", dimLabel: "D1", impact: "high", effort: "low", rationale: "", explore: "", projectedPoints: 3 });

/** Deps that always "work": one open follow-up per repo, an agent that succeeds, a rescan that closes it.
 *  `laneKind` is pinned to the AGENT lane here — the real resolver reads the paired working copy off
 *  disk, and these paths are fictional, so without the stub every repo would read as "no `.ai/`
 *  foundation" and every test above would silently become a foundation-lane test. The kinds have
 *  their own describe block below. */
function workingDeps(over: Partial<LaneDeps> = {}): Partial<LaneDeps> {
  return {
    openBatch: vi.fn(async (_org: string, repo: string) => [item(`rec-${repo}`, repo)]) as unknown as LaneDeps["openBatch"],
    laneKind: vi.fn(async () => BACKLOG_LANE),
    install: vi.fn(async () => ({ ok: true, written: [], skipped: [], committed: false, summary: "not used" })),
    runAgent: vi.fn(async () => ({ ok: true, summary: "did the thing" })),
    commitWork: vi.fn(async () => ({ committed: true, files: 2, resolved: [], summary: "the lane committed the agent's work" })),
    rescan: vi.fn(async ({ repo, onStage }) => {
      onStage("analyze");
      return { scanId: `scan-after-${repo}`, closedIds: [`rec-${repo}`] };
    }),
    ...over,
  };
}

/** Wait until every run this process is driving has finished. */
async function settle(runId: string): Promise<void> {
  for (let i = 0; i < 2000 && isLoopRunLive(runId); i += 1) await new Promise((r) => setTimeout(r, 1));
}

beforeEach(() => {
  db.runs = [];
  db.lanes = [];
  db.seq = 0;
  gitCommits.n = 1;
});

describe("startLoopRun — the happy path", () => {
  it("drives every repo to a done lane and finishes the run", async () => {
    const run = await startLoopRun({ org: "acme", repos: ["acme/web", "acme/api"], maxCycles: 1, deps: workingDeps() });
    await settle(run.id);
    expect(db.runs[0]!.phase).toBe("done");
    expect(db.runs[0]!.cycle).toBe(1);
    const lanes = db.lanes.filter((l) => l.runId === run.id);
    expect(lanes).toHaveLength(2);
    for (const lane of lanes) {
      expect(lane.phase).toBe("done");
      expect(lane.commits).toBe(1);
      expect(lane.closedIds).toEqual([`rec-${lane.repoFullName}`]);
      expect(lane.beforeScanId).toBe("scan-before");
      expect(lane.afterScanId).toBe(`scan-after-${lane.repoFullName}`);
      // The live sub-stage is cleared when the lane ends — a finished lane must not read as scanning.
      expect(lane.stage).toBeNull();
      expect(lane.branch).toBe(`ascent/loop-202608221000-${lane.repoFullName.replace("/", "-")}`);
    }
  });

  it("uses the curated batch for cycle 1 and auto-picks afterwards", async () => {
    const openBatch = vi.fn(async (_org: string, repo: string) => [item("rec-a", repo), item("rec-b", repo)]);
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 2,
      curated: true,
      batches: { "acme/web": ["rec-b"] },
      deps: workingDeps({ openBatch: openBatch as unknown as LaneDeps["openBatch"] }),
    });
    await settle(run.id);
    const lanes = db.lanes.filter((l) => l.runId === run.id).sort((a, b) => a.cycle - b.cycle);
    expect(lanes[0]!.batchIds).toEqual(["rec-b"]); // curated
    expect(lanes[1]!.batchIds).toEqual(["rec-a", "rec-b"]); // auto-picked
  });
});

describe("startLoopRun — failure isolation and the early stop", () => {
  it("keeps the run going when one lane's agent throws", async () => {
    const runAgent = vi.fn(async ({ cwd }: { cwd: string }) => {
      if (cwd.includes("acme-api")) throw new Error("claude CLI missing");
      return { ok: true, summary: "ok" };
    });
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web", "acme/api"],
      maxCycles: 1,
      deps: workingDeps({ runAgent: runAgent as unknown as LaneDeps["runAgent"] }),
    });
    await settle(run.id);
    expect(db.runs[0]!.phase).toBe("done"); // the RUN is fine
    const byRepo = Object.fromEntries(db.lanes.map((l) => [l.repoFullName, l]));
    expect(byRepo["acme/api"]!.phase).toBe("error");
    expect(byRepo["acme/api"]!.error).toContain("claude CLI missing");
    expect(byRepo["acme/web"]!.phase).toBe("done");
  });

  it("drops a lane that made no progress but keeps cycling the ones that did", async () => {
    const rescan = vi.fn(async ({ repo }: { repo: string }) => ({
      scanId: `after-${repo}`,
      closedIds: repo === "acme/web" ? ["rec-acme/web"] : [],
    }));
    gitCommits.n = 0; // no commits anywhere — only the closed row counts as progress
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web", "acme/api"],
      maxCycles: 3,
      deps: workingDeps({ rescan: rescan as unknown as LaneDeps["rescan"] }),
    });
    await settle(run.id);
    const cycles = (repo: string) => db.lanes.filter((l) => l.repoFullName === repo).length;
    expect(cycles("acme/api")).toBe(1); // stalled on cycle 1 and dropped out
    expect(cycles("acme/web")).toBe(3); // kept closing a row every cycle
    expect(db.runs[0]!.phase).toBe("done");
  });

  it("a lane with nothing left to dispatch ends cleanly rather than erroring", async () => {
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 2,
      deps: workingDeps({ openBatch: (async () => []) as unknown as LaneDeps["openBatch"] }),
    });
    await settle(run.id);
    const lanes = db.lanes.filter((l) => l.runId === run.id);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.phase).toBe("done");
    expect(lanes[0]!.error).toBeNull();
  });
});

describe("startLoopRun — bounded parallelism", () => {
  it("never runs more lanes at once than `concurrency`", async () => {
    let inFlight = 0;
    let peak = 0;
    const runAgent = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true, summary: "ok" };
    });
    const run = await startLoopRun({
      org: "acme",
      repos: ["a/1", "a/2", "a/3", "a/4", "a/5"],
      maxCycles: 1,
      concurrency: 2,
      deps: workingDeps({ runAgent: runAgent as unknown as LaneDeps["runAgent"] }),
    });
    await settle(run.id);
    expect(peak).toBe(2);
    expect(db.lanes).toHaveLength(5);
  });
});

describe("stopLoopRun", () => {
  it("stops after the in-flight lanes and marks the run stopped", async () => {
    const runAgent = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, summary: "ok" };
    });
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 5,
      deps: workingDeps({ runAgent: runAgent as unknown as LaneDeps["runAgent"] }),
    });
    expect(await stopLoopRun(run.id)).toBe(true);
    await settle(run.id);
    expect(db.runs[0]!.phase).toBe("stopped");
    expect(db.runs[0]!.endedAt).not.toBeNull();
    // Exactly one cycle was entered; the stop is checked between phases, never mid-session.
    expect(db.lanes.filter((l) => l.runId === run.id)).toHaveLength(1);
  });

  it("refuses a second concurrent run for the same org", async () => {
    const slow = workingDeps({
      runAgent: (async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, summary: "ok" };
      }) as unknown as LaneDeps["runAgent"],
    });
    const first = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 1, deps: slow });
    await expect(startLoopRun({ org: "acme", repos: ["acme/api"], maxCycles: 1, deps: slow })).rejects.toThrow(/already active/i);
    await settle(first.id);
  });
});

describe("startLoopRun — the gates", () => {
  it("refuses an empty repo set", async () => {
    await expect(startLoopRun({ org: "acme", repos: [] })).rejects.toThrow(/at least one repository/i);
  });

  it("refuses when a repo has no local pairing", async () => {
    const { getRepoLocalPath } = await import("@/lib/db");
    vi.mocked(getRepoLocalPath).mockResolvedValueOnce(null);
    await expect(startLoopRun({ org: "acme", repos: ["acme/web"], deps: workingDeps() })).rejects.toThrow(/not paired/i);
  });

  it("refuses when the pairing no longer verifies", async () => {
    const { verifyLocalPath } = await import("@/lib/local/pairing");
    vi.mocked(verifyLocalPath).mockResolvedValueOnce({ ok: false, error: "not a git repo" } as Awaited<ReturnType<typeof verifyLocalPath>>);
    await expect(startLoopRun({ org: "acme", repos: ["acme/web"], deps: workingDeps() })).rejects.toThrow(/Pairing broken/i);
  });
});

describe("per-run agent configuration threads propose → start → the agent invocation", () => {
  it("records the RESOLVED model and effort on the run, and arms every lane's session with them", async () => {
    const runAgent = vi.fn(async () => ({ ok: true, summary: "did the thing" }));
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web", "acme/api"],
      maxCycles: 1,
      model: "opus",
      effort: "high",
      deps: workingDeps({ runAgent }),
    });
    await settle(run.id);

    // The row is what the ledger later reads to say which setup produced the lift.
    expect(db.runs[0]!.model).toBe("opus");
    expect(db.runs[0]!.effort).toBe("high");
    // And every session actually ran as that — one lane per repo, both armed identically.
    expect(runAgent).toHaveBeenCalledTimes(2);
    for (const call of runAgent.mock.calls) {
      expect(call[0]).toMatchObject({ model: "opus", effort: "high" });
    }
  });

  it("resolves the deployment default when nothing was picked, rather than storing null", async () => {
    vi.stubEnv("CLAUDE_MODEL", "haiku");
    const runAgent = vi.fn(async () => ({ ok: true, summary: "ok" }));
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 1, deps: workingDeps({ runAgent }) });
    await settle(run.id);
    // "whatever CLAUDE_MODEL was that day" is exactly what a null row could not tell anyone later.
    expect(db.runs[0]!.model).toBe("haiku");
    expect(runAgent.mock.calls[0]![0]).toMatchObject({ model: "haiku" });
    vi.unstubAllEnvs();
  });

  it("passes NO effort when none was chosen — the flag is absent, not defaulted", async () => {
    const runAgent = vi.fn(async () => ({ ok: true, summary: "ok" }));
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 1, deps: workingDeps({ runAgent }) });
    await settle(run.id);
    expect(db.runs[0]!.effort).toBeNull();
    expect(runAgent.mock.calls[0]![0]).not.toHaveProperty("effort");
  });

  it("reads the configuration off the ROW for later cycles, so a changed env cannot split a run", async () => {
    const runAgent = vi.fn(async () => ({ ok: true, summary: "ok" }));
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 3,
      model: "opus",
      deps: workingDeps({ runAgent }),
    });
    // Move the deployment default out from under the run while it is cycling.
    vi.stubEnv("CLAUDE_MODEL", "haiku");
    await settle(run.id);
    expect(runAgent.mock.calls.length).toBeGreaterThan(1);
    for (const call of runAgent.mock.calls) expect(call[0]).toMatchObject({ model: "opus" });
    vi.unstubAllEnvs();
  });
});

// ── lane kinds: the loop's own foundation / practice doors ───────────────────────────────────────
//
// Gap #5's whole point: before these, the local loop could only dispatch an agent, and installing the
// `.ai/` standard or a practice starter was a separate GitHub-App draft-PR door it never opened.

const foundationLane: LaneKindProposal = {
  kind: "foundation",
  practiceId: null,
  itemId: null,
  reason: "No .ai/ foundation in this repo — this lane installs the generated standard, then rescans.",
};
const practiceLane: LaneKindProposal = {
  kind: "practice",
  practiceId: "agent-guidance",
  itemId: "rec-acme/web",
  reason: "Agent guidance — this lane installs `AGENTS.md`.",
};

/** Deps whose kind resolver answers with `plan`, and whose install always lands a commit. */
function kindDeps(plan: LaneKindProposal, over: Partial<LaneDeps> = {}): Partial<LaneDeps> {
  return workingDeps({
    laneKind: vi.fn(async () => plan),
    install: vi.fn(async () => ({ ok: true, written: [".ai/manifest.yaml"], skipped: [], committed: true, summary: "Installed 1 file(s)." })),
    ...over,
  });
}

describe("lane kinds — a foundation lane", () => {
  it("installs instead of dispatching an agent, then rescans exactly as the agent lane does", async () => {
    const deps = kindDeps(foundationLane);
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 1, deps });
    await settle(run.id);

    expect(deps.install).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.install!).mock.calls[0]![0]).toMatchObject({ kind: "foundation", org: "acme", repo: "acme/web" });
    expect(deps.runAgent).not.toHaveBeenCalled();
    const lane = db.lanes.find((l) => l.runId === run.id)!;
    expect(lane.phase).toBe("done");
    expect(lane.afterScanId).toBe("scan-after-acme/web"); // the SAME rescan + attribution path
    // No batch is claimed: the repo's backlog is not what a foundation lane is answering.
    expect(lane.batchIds).toEqual([]);
  });

  it("records the kind on the run row, so the ledger can still say what the lane did", async () => {
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 1, deps: kindDeps(foundationLane) });
    await settle(run.id);
    expect(db.runs[0]!.targets).toEqual([{ repo: "acme/web", kind: "foundation", practiceId: null }]);
  });

  it("is a CYCLE-1 lane — cycle 2 works the backlog with the standard already in place", async () => {
    const deps = kindDeps(foundationLane);
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 2, deps });
    await settle(run.id);
    expect(deps.install).toHaveBeenCalledTimes(1);
    expect(deps.runAgent).toHaveBeenCalledTimes(1); // cycle 2
  });

  it("ends the lane cleanly when the install wrote nothing — there is nothing to attribute", async () => {
    const deps = kindDeps(foundationLane, {
      install: vi.fn(async () => ({ ok: true, written: [], skipped: [], committed: false, summary: "Already installed — the spine is present." })),
    });
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 2, deps });
    await settle(run.id);
    const lane = db.lanes.find((l) => l.runId === run.id)!;
    expect(lane.phase).toBe("done");
    expect(lane.error).toBeNull();
    expect(deps.rescan).not.toHaveBeenCalled();
    expect(db.lanes).toHaveLength(1); // no progress ⇒ the repo drops out, as any dry lane does
  });

  it("surfaces a failed install as a lane error rather than taking the run down", async () => {
    const deps = kindDeps(foundationLane, {
      install: vi.fn(async () => ({ ok: false, written: [], skipped: [], committed: false, summary: "No saved scan for this repository yet." })),
    });
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 1, deps });
    await settle(run.id);
    expect(db.runs[0]!.phase).toBe("done");
    expect(db.lanes[0]!.phase).toBe("error");
    expect(db.lanes[0]!.error).toMatch(/no saved scan/i);
  });
});

describe("lane kinds — a practice lane", () => {
  it("claims the one row its starter answers and hands the id to the install as the trailer", async () => {
    const deps = kindDeps(practiceLane);
    const run = await startLoopRun({ org: "acme", repos: ["acme/web"], maxCycles: 1, deps });
    await settle(run.id);
    expect(vi.mocked(deps.install!).mock.calls[0]![0]).toMatchObject({
      kind: "practice",
      practiceId: "agent-guidance",
      resolvesId: "rec-acme/web",
    });
    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(db.lanes[0]!.batchIds).toEqual(["rec-acme/web"]);
    expect(db.runs[0]!.targets).toEqual([{ repo: "acme/web", kind: "practice", practiceId: "agent-guidance" }]);
  });

  it("yields to a curated batch that pruned its row — the operator's pick wins", async () => {
    const deps = kindDeps(practiceLane);
    const run = await startLoopRun({
      org: "acme",
      repos: ["acme/web"],
      maxCycles: 1,
      curated: true,
      batches: { "acme/web": ["some-other-row"] },
      deps: { ...deps, openBatch: vi.fn(async () => [item("some-other-row", "acme/web")]) as unknown as LaneDeps["openBatch"] },
    });
    await settle(run.id);
    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.runAgent).toHaveBeenCalledTimes(1);
  });
});
