// APPROVING HELD WORK LANDS THE REVIEWED COMMITS (challenge-2026-09-23, card live-war-room#B).
//
// A directed batch whose approved plan carries a held branch ADOPTS those commits instead of spending a
// second agent session re-deriving them: no session is dispatched, the guard and the rescan still
// adjudicate what landed, the fence is skipped (the reviewed diff IS the declaration) and the plan
// settles `landed`. When the branch no longer applies, the lane falls back to today's fresh session
// and says why. And the degradation guard still refuses an adopted diff that regresses the check.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const releases: { ids: string[]; why: string }[] = [];
const gitCalls: string[][] = [];

vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[], why: string) => {
    releases.push({ ids: [...ids], why });
    return ids.length;
  }),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async () => ({})),
  appendLaneLog: vi.fn(async (_id: string, line: string) => {
    logs.push(line);
  }),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/lane-outcomes", () => ({ recordLaneOutcomes: vi.fn(async () => []), getActiveDeferrals: vi.fn(async () => new Set<string>()) }));
vi.mock("@/lib/db/playbooks", () => ({ stampPlaybookApplications: vi.fn(async () => 0) }));
vi.mock("@/lib/db/loop-lessons", () => ({ recordLoopLessons: vi.fn(async () => []), recordRedBaselineLesson: vi.fn(async () => null) }));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
const PASSED = { resolved: { command: "npm test", source: "package.json", rung: "primary" }, passed: true, note: null, narrowedFrom: null, triedNarrowed: [] };
vi.mock("@/lib/local/lane-guard", () => ({
  verifyBaseline: vi.fn(async () => PASSED),
  verifyResult: vi.fn(async () => ({ verdict: "verified", command: "npm test", rung: "primary", note: "Verified.", reject: false })),
  verifyRejectionLesson: () => "lesson",
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => {
    gitCalls.push([...args]);
    if (args[0] === "rev-list") return { ok: true, stdout: "2", stderr: "" };
    if (args[0] === "rev-parse") return { ok: true, stdout: "sha-before", stderr: "" };
    if (args[0] === "diff") return { ok: true, stdout: "a.ts\nb.ts", stderr: "" };
    return { ok: true, stdout: "", stderr: "" };
  }),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {}, isWorkingCopyDirty: vi.fn(async () => false) }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "done" })) }));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { verifyResult } from "@/lib/local/lane-guard";
import type { DirectedBatch } from "@/lib/local/lane-plan";

const item = (id: string) => ({ id, repo: "o/r", title: id, dimId: "D3", dimLabel: "D3", impact: "high", effort: "low", rationale: "", explore: [], projectedPoints: 3 });
const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;
const directed = (adoptBranch: string | null): DirectedBatch => ({
  planId: "p1", directionId: "d1", items: [item("r1"), item("r2")], planBlock: "YOUR PLAN", directionFence: ["src/"], declaredMoves: [], adoptBranch,
});

function lane(over: Partial<LaneDeps> & { adoptBranch?: string | null } = {}) {
  const { adoptBranch = "ascent/held/p1", ...rest } = over;
  const deps = {
    loadPair: vi.fn(async () => null),
    summarize: vi.fn(async (l: unknown) => l),
    baseRelation: vi.fn(async () => "linear" as const),
    priorBaselines: vi.fn(async () => []),
    loadBrief: vi.fn(async () => null),
    readReport: vi.fn(async () => null),
    nextDirected: vi.fn(async () => directed(adoptBranch)),
    adopt: vi.fn(async () => ({ ok: true as const, commits: 2 })),
    landPlan: vi.fn(async () => {}),
    settlePlan: vi.fn(async () => {}),
    chargePlanCost: vi.fn(async () => {}),
    checkPlanFence: vi.fn(async () => ({ verdict: "land" as const })),
    runAgent: vi.fn(async () => ({ ok: true, summary: "re-derived" })),
    runAgentVia: vi.fn(async () => ({ ok: true, summary: "re-derived" })),
    commitWork: vi.fn(async () => ({ committed: true, files: 2, resolved: [], summary: "committed" })),
    gateDiff: vi.fn(() => ({ void: false, paths: [], reason: null })),
    activitySink: vi.fn(() => ({ onEvent: () => {}, flush: async () => {} })),
    worktreePoll: vi.fn(() => () => {}),
    rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: [] })),
    ...rest,
  };
  const done = runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
    runner: { plan: true, autoKeepLessons: false, installDeps: false },
    deps: deps as unknown as Partial<LaneDeps>,
  });
  return { deps, done };
}

beforeEach(() => {
  logs.length = 0;
  releases.length = 0;
  gitCalls.length = 0;
  vi.mocked(verifyResult).mockClear();
});

describe("a directed lane over held work", () => {
  it("adopts the held commits: no agent session, guard and rescan still run, no fence, the plan lands", async () => {
    const { deps, done } = lane();
    const res = await done;
    expect(deps.adopt).toHaveBeenCalledWith(expect.objectContaining({ dir: "C:/tmp/wt", heldBranch: "ascent/held/p1" }));
    expect(deps.runAgent).toHaveBeenCalledTimes(0);
    expect(deps.runAgentVia).toHaveBeenCalledTimes(0);
    expect(logs.some((l) => l.startsWith("Adopted 2 commit(s) from ascent/held/p1 — no agent session was spent"))).toBe(true);
    expect(verifyResult).toHaveBeenCalledTimes(1);
    expect(deps.rescan).toHaveBeenCalledTimes(1);
    expect(deps.checkPlanFence).not.toHaveBeenCalled();
    expect(deps.landPlan).toHaveBeenCalledWith("p1");
    expect(deps.settlePlan).not.toHaveBeenCalled();
    expect(deps.commitWork).not.toHaveBeenCalled();
    expect(res).toMatchObject({ commits: 2, progressed: true, error: null });
  });

  it("falls back to today's fresh session when the held branch no longer applies, and says why", async () => {
    const reason = "cherry-picking ascent/held/p1 onto the lane conflicted (CONFLICT (content): Merge conflict in a.ts), so it was aborted";
    const { deps, done } = lane({ adopt: vi.fn(async () => ({ ok: false as const, reason })) });
    await done;
    expect(deps.runAgent).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("could not be adopted") && l.includes(reason))).toBe(true);
    expect(deps.checkPlanFence).toHaveBeenCalledTimes(1);
    expect(deps.landPlan).not.toHaveBeenCalled();
  });

  it("guard: a directed plan with no held branch executes exactly as today — fresh session, fence checked", async () => {
    const { deps, done } = lane({ adoptBranch: null });
    await done;
    expect(deps.adopt).not.toHaveBeenCalled();
    expect(deps.runAgent).toHaveBeenCalledTimes(1);
    expect(deps.checkPlanFence).toHaveBeenCalledTimes(1);
  });

  it("guard: the degradation guard still rejects an adopted diff — nothing is committed and the claims are released", async () => {
    vi.mocked(verifyResult).mockResolvedValueOnce({ verdict: "rejected", command: "npm test", rung: "primary", note: "Rejected.", reject: true });
    const { deps, done } = lane();
    const res = await done;
    expect(res.commits).toBe(0);
    expect(gitCalls).toContainEqual(["reset", "--hard", "sha-before"]);
    expect(releases.flatMap((r) => r.ids)).toEqual(["r1", "r2"]);
    expect(deps.rescan).not.toHaveBeenCalled();
    expect(deps.landPlan).not.toHaveBeenCalled();
    expect(deps.settlePlan).toHaveBeenCalledWith("p1");
  });
});
