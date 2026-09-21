// A LANE THAT IS ARMED — what it spawns, what it records, and the one verdict that stops it banking
// a lift (spark local-model-lanes, 2026-09-21).
//
// What these pin:
//   • a SPLIT arm ("Claude plans, a local model executes") dispatches its two sessions through TWO
//     DIFFERENT transports — the configuration the old model/effort pair could not express at all;
//   • the lane row records all three facts: the executing transport, the executing model, and the
//     model that actually planned;
//   • a VOID verdict from `checkGateDiff` sets phase `void` with its reason, suppresses the rescan
//     and the lift, and is REPORTED as an outcome rather than dropped;
//   • an UNARMED lane never reaches the transport door at all — the pre-arms path is the same call it
//     always was, which is the property acceptance #4 rests on.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const patches: Record<string, unknown>[] = [];
const upserts: Record<string, unknown>[] = [];

vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[]) => ids.length),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async (key: Record<string, unknown>) => {
    upserts.push(key);
    return { id: "lane-1" };
  }),
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
    // The lane's OWN committed paths — what the integrity guard is given to judge.
    if (args[0] === "diff") return { ok: true, stdout: ["src/app.ts", "src/app.test.ts"].join("\n"), stderr: "" };
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

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import type { Arm } from "@/lib/local/arm";

const SESSION_MS = 60_000;
const VERIFY_MS = 600_000;
const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;

const batchItem = (id: string) => ({
  id, repo: "o/r", title: "t", dimId: "D2", dimLabel: "Tests",
  impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5,
});

/** "Claude plans, a local model executes" — the arm the old model/effort pair could not hold. */
const SPLIT_ARM: Arm = {
  id: "split",
  label: "claude plan -> local exec",
  transport: "pi",
  model: "qwen3.8:27b",
  plan: { transport: "claude", model: "sonnet" },
};

const runAgent = vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - did it" }));
const runAgentVia = vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - did it" }));
const gateDiff = vi.fn(() => ({ void: false, reason: null as string | null, paths: [] as string[] }));

const deps = (over: Partial<LaneDeps> = {}): Partial<LaneDeps> => ({
  runAgent: runAgent as never,
  runAgentVia: runAgentVia as never,
  gateDiff: gateDiff as never,
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
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
    agent: { timeoutMs: SESSION_MS },
    verify: { enabled: true, timeoutMs: VERIFY_MS },
    deps: deps(over_deps),
    ...over,
  });

/** The newest patch that mentioned a field, so "did the lane ever record X" is one lookup. */
const recorded = (field: string): unknown => [...patches].reverse().find((p) => p[field] !== undefined)?.[field];
const terminal = () => [...patches].reverse().find((p) => p.phase === "error" || p.phase === "done" || p.phase === "void");

/** A planning seam that answers with an executable plan, so the lane reaches its execution session. */
const planned = (planModel: string | null) =>
  vi.fn(async () => ({
    mode: "execute" as const,
    planId: "plan-1",
    execute: [batchItem("a")],
    parked: [],
    planBlock: "THE PLAN",
    resumeSessionId: null,
    declaredMoves: [],
    directionFence: null,
    planModel,
  }));

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  upserts.length = 0;
  runAgent.mockClear();
  runAgentVia.mockClear();
  gateDiff.mockClear();
  gateDiff.mockImplementation(() => ({ void: false, reason: null, paths: [] }));
});

describe("a SPLIT arm — Claude plans, a local model executes", () => {
  it("dispatches the EXECUTING session through the arm's executing transport, not the Claude door", async () => {
    await run(
      { arm: SPLIT_ARM, runner: { plan: true, autoKeepLessons: false, installDeps: false } },
      { planLane: planned("sonnet") as never },
    );

    expect(runAgentVia).toHaveBeenCalledTimes(1);
    expect(runAgentVia.mock.calls[0]![0]).toBe("pi");
    expect((runAgentVia.mock.calls[0]![1] as { model?: string }).model).toBe("qwen3.8:27b");
    // The Claude-only door is not touched at all: an armed lane goes through ONE seam.
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("records the executing transport, the executing model and the PLANNING model on the row", async () => {
    await run(
      { arm: SPLIT_ARM, runner: { plan: true, autoKeepLessons: false, installDeps: false } },
      { planLane: planned("sonnet") as never },
    );
    // Stamped at CREATE, so the row knows what it is from the moment it exists rather than only after
    // its session returns.
    expect(upserts[0]).toMatchObject({ armId: "split", transport: "pi" });
    expect(recorded("planModel")).toBe("sonnet");
  });

  it("hands the planning seam the arm and the transport door — its PLANNING half is what spawns", async () => {
    const planLane = vi.fn(async () => ({ mode: "skip" as const }));
    await run({ arm: SPLIT_ARM, runner: { plan: true, autoKeepLessons: false, installDeps: false } }, { planLane: planLane as never });
    const arg = planLane.mock.calls[0]![0] as { arm?: Arm; runVia?: unknown; planTimeoutMs?: number };
    expect(arg.arm).toEqual(SPLIT_ARM);
    // Without the door, `planLane` would fall back to the Claude-only path and the split would be
    // silently collapsed into a pure-local arm recorded under the wrong name.
    expect(typeof arg.runVia).toBe("function");
  });

  it("a lane that never planned records NO planModel — an absence, not the executing model", async () => {
    await run({ arm: SPLIT_ARM });
    expect(recorded("planModel")).toBeUndefined();
    expect(upserts[0]).toMatchObject({ armId: "split", transport: "pi" });
  });
});

describe("an UNARMED lane", () => {
  it("never reaches the transport door — the pre-arms path is the call it always was", async () => {
    const res = await run();
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgentVia).not.toHaveBeenCalled();
    expect(res.progressed).toBe(true);
    // Nothing arm-shaped is stamped on a row that has no arm: unknown, never defaulted to "claude".
    expect(upserts[0]).not.toHaveProperty("armId");
    expect(recorded("transport")).toBeUndefined();
  });
});

describe("THE INTEGRITY GUARD — a lane may not edit the surface that scores it", () => {
  it("is asked about the lane's OWN committed paths, after the commits and before any rescan", async () => {
    const rescan = vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] }));
    await run({}, { rescan });
    expect(gateDiff).toHaveBeenCalledTimes(1);
    expect(gateDiff.mock.calls[0]![0]).toEqual(["src/app.ts", "src/app.test.ts"]);
    // A non-void verdict changes nothing: the lane rescans exactly as it always did.
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("a VOID verdict sets phase `void` with its reason and suppresses the lift", async () => {
    const rescan = vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] }));
    gateDiff.mockImplementation(() => ({ void: true, reason: "It edited a test file it is scored on.", paths: ["src/app.test.ts"] }));
    const res = await run({}, { rescan });

    // NO RESCAN: nothing this lane changed becomes the repository's latest reading.
    expect(rescan).not.toHaveBeenCalled();
    expect(res).toMatchObject({ progressed: false, closed: 0, error: null });
    expect(terminal()).toMatchObject({ phase: "void", voidReason: "It edited a test file it is scored on." });
  });

  it("REPORTS the void as an outcome rather than dropping it", async () => {
    gateDiff.mockImplementation(() => ({ void: true, reason: "It edited the verify command.", paths: ["package.json"] }));
    await run();
    // A silently discarded void lane flatters the arm that produced it, which is the failure this
    // guard exists to prevent — so it names itself in the log AND in the deliverables.
    expect(logs.some((l) => l.startsWith("VOID:") && l.includes("package.json"))).toBe(true);
    const delivered = recorded("deliverables") as { headline: string }[] | undefined;
    expect(delivered?.[0]?.headline).toContain("Void");
  });
});
