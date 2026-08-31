// THE DEGRADATION GUARD, WIRED INTO A LANE — what a rejected cycle does and, just as importantly,
// what a baseline-red and an unresolvable one do NOT do.
//
// The pure verdicts live in lane-guard.test.ts. These cases pin the consequences: a rejected lane
// commits nothing, rescans nothing, claims nothing and persists `rejected` on its row (which is what
// `loop-delivery.ts` and the one-click PR door refuse on); a baseline-red lane behaves exactly as it
// did before the guard existed; and a run with the guard switched off is byte-identical to today's
// loop, with `skipped` recorded so silence never reads as a pass.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const patches: Record<string, unknown>[] = [];
const lessons: string[][] = [];
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
  recordLoopLessons: vi.fn(async (_o: string, _r: string, _l: string, list: string[]) => {
    lessons.push(list);
    return [];
  }),
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

// THE GUARD ITSELF is mocked at the module seam rather than through `LaneDeps`: it is not an injected
// dependency of the lane, it is machinery the lane owns, and the thing under test is what the lane
// DOES with each verdict.
const guard = vi.hoisted(() => ({
  baseline: { resolved: { command: "npm run check:ci", source: "package.json" }, passed: true as boolean | null, note: null as string | null },
  outcome: {
    verdict: "verified" as string,
    command: "npm run check:ci",
    note: "Verified: it passed.",
    reject: false,
  },
  baselineCalls: 0,
  resultCalls: 0,
}));
vi.mock("@/lib/local/lane-guard", () => ({
  verifyBaseline: vi.fn(async () => {
    guard.baselineCalls += 1;
    return guard.baseline;
  }),
  verifyResult: vi.fn(async () => {
    guard.resultCalls += 1;
    return guard.outcome;
  }),
  verifyRejectionLesson: (repo: string) => `lesson about ${repo}`,
  forgetVerifyBaseline: vi.fn(),
}));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";

const batchItem = (id: string) => ({
  id, repo: "o/r", title: "t", dimId: "D2", dimLabel: "Tests",
  impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5,
});

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;

const commitWork = vi.fn(async () => ({ committed: true, files: 2, resolved: ["a"], summary: "committed 2 file(s)" }));
const rescan = vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] }));
const openBatchFn = vi.fn(async () => [batchItem("a")]);
const runAgent = vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - Did the thing" }));

const run = (over: Parameters<typeof runLane>[0] extends infer T ? Partial<T> : never = {}) =>
  runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
    deps: {
      runAgent: runAgent as never,
      commitWork: commitWork as never,
      rescan,
      openBatch: openBatchFn,
      loadBrief: vi.fn(async () => null) as never,
      readReport: vi.fn(async () => null) as never,
      loadPair: vi.fn(async () => null),
      summarize: vi.fn(async (l) => l),
    } as Partial<LaneDeps>,
    ...over,
  });

const lastVerifyPatch = () => [...patches].reverse().find((p) => "verifyVerdict" in p);

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  lessons.length = 0;
  released.length = 0;
  guard.baseline = { resolved: { command: "npm run check:ci", source: "package.json" }, passed: true, note: null };
  guard.outcome = { verdict: "verified", command: "npm run check:ci", note: "Verified: it passed.", reject: false };
  guard.baselineCalls = 0;
  guard.resultCalls = 0;
  commitWork.mockClear();
  rescan.mockClear();
  runAgent.mockClear();
  openBatchFn.mockClear();
});

describe("a REJECTED lane", () => {
  beforeEach(() => {
    guard.outcome = {
      verdict: "rejected",
      command: "npm run check:ci",
      note: "Verification REJECTED this cycle: `npm run check:ci` … First failure:\nAssertionError",
      reject: true,
    };
  });

  it("commits NOTHING and rescans NOTHING", async () => {
    const res = await run();
    // The commit is what would put a regression on a branch; the rescan is what would make a
    // worktree nobody kept into this repository's latest reading.
    expect(commitWork).not.toHaveBeenCalled();
    expect(rescan).not.toHaveBeenCalled();
    expect(res.commits).toBe(0);
    expect(res.progressed).toBe(false);
    expect(res.error).toBeNull(); // an honest end, not a lane failure
  });

  it("persists `rejected` with the command and the failure — the column delivery refuses on", async () => {
    await run();
    const patch = lastVerifyPatch();
    expect(patch?.verifyVerdict).toBe("rejected");
    expect(patch?.verifyCommand).toBe("npm run check:ci");
    expect(String(patch?.verifyNote)).toContain("AssertionError");
  });

  it("releases the batch it claimed rather than leaving zombie rows", async () => {
    await run();
    expect(released).toContain("a");
  });

  it("records a lesson and a deliverable, so the reversal is visible on the sheet", async () => {
    await run();
    expect(lessons.flat().some((l) => l.includes("o/r"))).toBe(true);
    const withDeliverables = patches.find((p) => Array.isArray(p.deliverables));
    const rows = withDeliverables?.deliverables as { headline: string; kind: string; covers: string[] }[];
    expect(rows[0]!.headline).toMatch(/discarded/i);
    // It covers NOTHING: no follow-up was closed, and listing the armed ids would file them in the
    // ledger under a cycle that delivered none of them.
    expect(rows[0]!.covers).toEqual([]);
  });
});

describe("a BASELINE-RED repository", () => {
  it("is not blamed — the lane commits and rescans exactly as it would without a guard", async () => {
    guard.baseline = { resolved: { command: "npm test", source: "package.json" }, passed: false, note: "FAIL" };
    guard.outcome = { verdict: "baseline-red", command: "npm test", note: "already failed", reject: false };

    const res = await run();
    expect(commitWork).toHaveBeenCalledTimes(1);
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(lastVerifyPatch()?.verifyVerdict).toBe("baseline-red");
    expect(res.progressed).toBe(true);
    expect(logs.some((l) => /not blamed|already FAILS/i.test(l))).toBe(true);
  });

  it("does NOT promise the agent a safety net that is not there", async () => {
    guard.baseline = { resolved: { command: "npm test", source: "package.json" }, passed: false, note: "FAIL" };
    guard.outcome = { verdict: "baseline-red", command: "npm test", note: "already failed", reject: false };
    await run();
    const prompt = (runAgent.mock.calls[0]![0] as unknown as { prompt: string }).prompt;
    expect(prompt).not.toContain("THE SAFETY NET");
  });
});

describe("a repository that declares no check", () => {
  it("is SKIPPED honestly — the lane proceeds and the row says it is unverified", async () => {
    guard.baseline = { resolved: null, passed: null, note: null };
    guard.outcome = { verdict: "skipped", command: null, note: "Verification SKIPPED: …UNVERIFIED, not verified.", reject: false };

    const res = await run();
    expect(res.progressed).toBe(true);
    expect(commitWork).toHaveBeenCalledTimes(1);
    expect(lastVerifyPatch()?.verifyVerdict).toBe("skipped");
    expect(logs.some((l) => /declares no check/i.test(l))).toBe(true);
  });
});

describe("the guard switched off", () => {
  it("runs neither half of it, and still records `skipped` rather than nothing", async () => {
    const res = await run({ verify: { enabled: false } });
    // Byte-identical to the pre-guard lane: no baseline, no result run, commit and rescan as always.
    expect(guard.baselineCalls).toBe(0);
    expect(guard.resultCalls).toBe(0);
    expect(commitWork).toHaveBeenCalledTimes(1);
    expect(res.progressed).toBe(true);
    // …but never null. Null is what a lane written before the guard carries; "we did not check" must
    // not be able to masquerade as "there was nothing to check".
    expect(lastVerifyPatch()?.verifyVerdict).toBe("skipped");
    expect(String(lastVerifyPatch()?.verifyNote)).toMatch(/switched off/i);
  });

  it("gives the agent no promise of a net", async () => {
    await run({ verify: { enabled: false } });
    expect((runAgent.mock.calls[0]![0] as unknown as { prompt: string }).prompt).not.toContain("THE SAFETY NET");
  });
});

describe("a VERIFIED lane", () => {
  it("proceeds, and its brief told the agent the net was real", async () => {
    const res = await run();
    expect(res.progressed).toBe(true);
    expect(lastVerifyPatch()?.verifyVerdict).toBe("verified");
    const prompt = (runAgent.mock.calls[0]![0] as unknown as { prompt: string }).prompt;
    expect(prompt).toContain("THE SAFETY NET");
    expect(prompt).toContain("npm run check:ci");
    expect(prompt).toContain("LARGER CHANGE");
  });
});

describe("the batch size is a per-run parameter", () => {
  it("defaults to the five the loop always used", async () => {
    await run();
    expect(openBatchFn.mock.calls[0]![2]).toBe(5);
  });

  it("passes the run's own size through to the batch read", async () => {
    await run({ batchSize: 10 });
    expect(openBatchFn.mock.calls[0]![2]).toBe(10);
  });

  it("ignores it on a CURATED batch, which names its own rows", async () => {
    await run({ batch: ["a"], batchSize: 10 });
    expect(openBatchFn.mock.calls[0]![2]).toBe(500);
  });
});

describe("the session ceiling is a per-run knob", () => {
  it("hands the agent runner the run's own timeout, and nothing when none was chosen", async () => {
    // A campaign lane committed the line "Agent session exceeded 20 min and was stopped" mid-change.
    // The knob is what lets a run buy the time; `agent.ts` still bounds it on both sides.
    await run({ agent: { model: "opus", effort: null, timeoutMs: 2_700_000 } });
    expect((runAgent.mock.calls[0]![0] as unknown as { timeoutMs?: number }).timeoutMs).toBe(2_700_000);

    runAgent.mockClear();
    await run();
    // Absent, not zero: the runner then falls back to the deployment's ASCENT_AUTOPILOT_TIMEOUT_MS,
    // which is what every session before this parameter used.
    expect((runAgent.mock.calls[0]![0] as unknown as { timeoutMs?: number }).timeoutMs).toBeUndefined();
  });
});
