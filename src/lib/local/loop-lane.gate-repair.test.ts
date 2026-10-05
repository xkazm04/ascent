// THE GATE-REPAIR TURN AT THE CALL SITE (2026-10-05). A no-check repo's bootstrap whose declared gate
// fails on the lane's tree is resumed ONCE in the same session with the failure output; when the fixed
// gate passes, the lane ends NOT void and verified against it (case D), exactly like a bootstrap that
// passed first time. Evidence reads are faked; the guard is the real `checkGateDiff`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const patches: Record<string, unknown>[] = [];

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
vi.mock("@/lib/db/loop-lessons", () => ({ recordLoopLessons: vi.fn(async () => []), recordRedBaselineLesson: vi.fn(async () => null) }));
const PATHS = [".ai/manifest.yaml", "tools/lint.mjs"];
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: readonly string[]) => {
    if (args[0] === "rev-list") return { ok: true, stdout: "1", stderr: "" };
    if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
    if (args[0] === "diff") return { ok: true, stdout: PATHS.join("\n"), stderr: "" };
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
  verifyResult: vi.fn(async () => ({ verdict: "skipped", command: null, rung: null, note: "Verification SKIPPED.", reject: false })),
  verifyRejectionLesson: () => "lesson",
  forgetVerifyBaseline: vi.fn(),
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));
const LINT = "node tools/lint.mjs";
const evidenceRuns = vi.hoisted(() => ({ queue: [] as boolean[] }));
vi.mock("@/lib/local/lane-gate-diff-load", () => ({
  readGateDiffEvidence: vi.fn(async () => {
    const ok = evidenceRuns.queue.shift() ?? false;
    return {
      statuses: { ".ai/manifest.yaml": "A", "tools/lint.mjs": "A" },
      verifyLadder: { before: [], after: [{ command: "node tools/lint.mjs", rung: "primary" }] },
      laneVerdict: { verdict: "skipped", command: null },
      declaredGateRuns: [{ command: "node tools/lint.mjs", rung: "primary", ok, timedOut: false, output: ok ? "ok" : "FAIL tools/lint.mjs: Cannot find module './rules.mjs'" }],
    };
  }),
}));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { checkGateDiff } from "@/lib/local/lane-gate-diff";

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;
const batchItem = { id: "a", repo: "o/r", title: "t", dimId: "D1", dimLabel: "Guidance", impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5 };

type AgentCall = { prompt: string; resumeSessionId?: string | null; timeoutMs?: number | null };
const runAgent = vi.fn<(o: AgentCall) => Promise<{ ok: boolean; summary: string; sessionId: string }>>(async () => ({
  ok: true,
  summary: "RESOLVED: a - declared the gate",
  sessionId: "11111111-2222-3333-4444-555555555555",
}));
const commitWork = vi.fn(async () => ({ committed: true, files: 2, resolved: ["a"], summary: "committed" }));
const rescan = vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] }));

const run = () =>
  runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
    agent: { timeoutMs: 60 * 60_000 },
    verify: { enabled: true, timeoutMs: 600_000 },
    deps: {
      runAgent: runAgent as never,
      gateDiff: checkGateDiff,
      commitWork: commitWork as never,
      rescan,
      openBatch: vi.fn(async () => [batchItem]),
      loadBrief: vi.fn(async () => null) as never,
      readReport: vi.fn(async () => null) as never,
      loadPair: vi.fn(async () => null),
      summarize: vi.fn(async (l) => l),
      priorBaselines: vi.fn(async () => []),
    } satisfies Partial<LaneDeps>,
  });

const row = (): Record<string, unknown> => Object.assign({}, ...patches);

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  runAgent.mockClear();
  commitWork.mockClear();
  rescan.mockClear();
});

describe("a bootstrap fixed by the gate-repair turn", () => {
  it("resumes the execution session once, commits the fix, and ends verified and NOT void", async () => {
    evidenceRuns.queue = [false, true];
    await run();
    expect(runAgent).toHaveBeenCalledTimes(2);
    const repair = runAgent.mock.calls[1]![0];
    expect(repair.resumeSessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(repair.prompt).toContain("Your declared gate does not pass on your own result");
    expect(repair.prompt).toContain("Cannot find module './rules.mjs'");
    expect(repair.timeoutMs).toBe(10 * 60_000);
    expect(commitWork).toHaveBeenCalledTimes(2);
    const lane = row();
    expect(lane.phase).not.toBe("void");
    expect(lane.voidReason).toBeUndefined();
    expect(lane).toMatchObject({ verifyVerdict: "verified", verifyCommand: LINT });
    expect(logs.some((l) => l.startsWith("Gate repair: the gate this lane declared does not pass"))).toBe(true);
    expect(logs.some((l) => l.startsWith("Gate repair cleared the lane"))).toBe(true);
    expect(logs.some((l) => l.startsWith("Gate declared:"))).toBe(true);
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("still failing after the one turn -> void, the reason naming the spent turn", async () => {
    evidenceRuns.queue = [false, false];
    await run();
    expect(runAgent).toHaveBeenCalledTimes(2);
    const lane = row();
    expect(lane.phase).toBe("void");
    expect(String(lane.voidReason)).toContain("One gate-repair turn was spent on it: the gate still does not pass");
    expect(rescan).not.toHaveBeenCalled();
  });
});
