// THE DEGRADATION GUARD, WIRED INTO A LANE — what a rejected cycle does and, just as importantly,
// what an unavailable baseline and an unresolvable one do NOT do.
//
// The pure verdicts live in lane-guard.test.ts. These cases pin the consequences: a rejected lane
// commits nothing, rescans nothing, claims nothing and persists `rejected` on its row (which is what
// `loop-delivery.ts` and the one-click PR door refuse on); a baseline-unavailable lane behaves exactly as it
// did before the guard existed; and a run with the guard switched off is byte-identical to today's
// loop, with `skipped` recorded so silence never reads as a pass.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const patches: Record<string, unknown>[] = [];
const lessons: string[][] = [];
const redLessons: string[] = [];
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
  recordRedBaselineLesson: vi.fn(async (_o: string, _r: string, content: string) => {
    redLessons.push(content);
    return null;
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
  baseline: {
    resolved: { command: "npm run check:ci", source: "package.json", rung: "primary" as string },
    passed: true as boolean | null,
    note: null as string | null,
    // THE NARROWING LADDER (lane-verify.ts): set when the declared command could not establish a
    // baseline in the worktree and the guard armed on a hermetic fallback instead.
    narrowedFrom: null as { command: string; source: string; rung: string } | null,
    triedNarrowed: [] as { command: string; source: string; rung: string }[],
  },
  outcome: {
    verdict: "verified" as string,
    command: "npm run check:ci",
    rung: "primary" as string | null,
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
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { updateRecommendation } from "@/lib/db/scans-recommendations";
import type { BaselineLaneRow } from "@/lib/local/lane-baseline";

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
      priorBaselines: vi.fn(async () => priorLanes),
    } as Partial<LaneDeps>,
    ...over,
  });

/** The repo's PREVIOUS guard verdicts, newest-first — what the attempt counter is derived from. */
const priorLanes: BaselineLaneRow[] = [];
const priorLane = (verdict: BaselineLaneRow["verifyVerdict"], at: string, note: string | null = null): BaselineLaneRow => ({
  repoFullName: "o/r", verifyVerdict: verdict, verifyCommand: "npm test", verifyNote: note, at,
});

const lastVerifyPatch = () => [...patches].reverse().find((p) => "verifyVerdict" in p);

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  lessons.length = 0;
  redLessons.length = 0;
  released.length = 0;
  priorLanes.length = 0;
  guard.baseline = {
    resolved: { command: "npm run check:ci", source: "package.json", rung: "primary" },
    passed: true,
    note: null,
    narrowedFrom: null,
    triedNarrowed: [],
  };
  guard.outcome = { verdict: "verified", command: "npm run check:ci", rung: "primary", note: "Verified: it passed.", reject: false };
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

describe("a repository with no establishable baseline", () => {
  it("is not blamed — the lane commits and rescans exactly as it would without a guard", async () => {
    guard.baseline = { resolved: { command: "npm test", source: "package.json" }, passed: false, note: "FAIL" };
    guard.outcome = { verdict: "baseline-unavailable", command: "npm test", note: "no baseline", reject: false };

    const res = await run();
    expect(commitWork).toHaveBeenCalledTimes(1);
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(lastVerifyPatch()?.verifyVerdict).toBe("baseline-unavailable");
    expect(res.progressed).toBe(true);
    expect(logs.some((l) => /no baseline could be established|cannot be verified/i.test(l))).toBe(true);
  });

  it("does NOT promise the agent a safety net that is not there", async () => {
    guard.baseline = { resolved: { command: "npm test", source: "package.json" }, passed: false, note: "FAIL" };
    guard.outcome = { verdict: "baseline-unavailable", command: "npm test", note: "no baseline", reject: false };
    await run();
    const prompt = (runAgent.mock.calls[0]![0] as unknown as { prompt: string }).prompt;
    expect(prompt).not.toContain("THE SAFETY NET");
  });
});

// ── AN UNVERIFIABLE CYCLE IS REPORTED, NOT TURNED INTO REPAIR WORK ────────────────────────
//
// This used to lead the brief with "restore `npm run test:unit` (attempt 14); the armed batch rides
// along, second". The premise was false — a worktree carries no gitignored local state, and
// `systedo-case` passes 3744/3744 in the operator's paired checkout — so the loop was ordering agents
// to repair a green suite. These pin what replaced it: a NEUTRAL note in the brief, a lane log line
// that claims only what was measured, and an OPERATOR lesson carrying the remedy. What deliberately
// does NOT change: nothing is written to the recommendations table — manufacturing a row there would
// corrupt the backlog the scan owns.

describe("a cycle the guard could not verify", () => {
  const red = { resolved: { command: "npm run test:unit", source: "package.json" }, passed: false as boolean | null };
  const redNote =
    "Verification NO BASELINE: `npm run test:unit` (from package.json) did not pass on the pristine lane worktree, " +
    "before the session started. First failure: ✖ test-unit/fault-injection-llm.test.mjs";

  const armRed = () => {
    guard.baseline = { ...red, note: redNote };
    guard.outcome = { verdict: "baseline-unavailable", command: "npm run test:unit", note: redNote, reject: false };
  };
  const promptOf = () => (runAgent.mock.calls[0]![0] as unknown as { prompt: string }).prompt;

  it("puts a NEUTRAL note in the brief — no lead, no repair, quoting what the command printed", async () => {
    armRed();
    await run();
    const prompt = promptOf();
    expect(prompt.startsWith("# Ascent follow-ups")).toBe(true);
    expect(prompt).not.toContain("TOP PRIORITY");
    expect(prompt).toContain("NO VERIFICATION NET THIS CYCLE:");
    expect(prompt).toContain("repairing them is NOT your task");
    expect(prompt).toContain("`npm run test:unit`");
    expect(prompt).toContain("✖ test-unit/fault-injection-llm.test.mjs");
    expect(commitWork).toHaveBeenCalledTimes(1);
  });

  it("never counts attempts — in the brief or in the lane log", async () => {
    armRed();
    priorLanes.push(
      priorLane("baseline-unavailable", "2026-08-30T09:00:00.000Z", redNote),
      priorLane("baseline-unavailable", "2026-08-29T09:00:00.000Z", redNote),
    );
    await run();
    expect(promptOf()).not.toMatch(/THIS IS ATTEMPT|attempt \d/i);
    expect(logs.some((l) => /attempt/i.test(l))).toBe(false);
    expect(redLessons[0]).not.toMatch(/attempt|not converging/i);
  });

  it("logs what was measured and nothing more — the worktree, never the repository", async () => {
    armRed();
    await run();
    const line = logs.find((l) => /No baseline/.test(l))!;
    expect(line).toContain("did not pass on the pristine worktree");
    expect(line).toContain("does NOT ask for a repair");
    expect(line).not.toMatch(/own checks (are )?fail/i);
  });

  it("is ABSENT when the baseline was established", async () => {
    await run(); // the default fixture: baseline resolved and PASSING
    expect(promptOf()).not.toContain("NO VERIFICATION NET");
    expect(redLessons).toEqual([]);
  });

  it("is absent when the repository declares no check and nothing was ever measured", async () => {
    guard.baseline = { resolved: null, passed: null, note: null };
    guard.outcome = { verdict: "skipped", command: null, note: "Verification SKIPPED: …", reject: false };
    await run();
    expect(promptOf()).not.toContain("NO VERIFICATION NET");
    expect(redLessons).toEqual([]);
  });

  it("is absent when a previous lane had none but this one ESTABLISHED a baseline", async () => {
    priorLanes.push(priorLane("baseline-unavailable", "2026-08-30T09:00:00.000Z", redNote));
    await run(); // default fixture: passing baseline
    expect(promptOf()).not.toContain("NO VERIFICATION NET");
  });

  it("records the OPERATOR's lesson, with the remedy that is actually in their hands", async () => {
    armRed();
    await run();
    expect(redLessons).toHaveLength(1);
    expect(redLessons[0]).toContain("Baseline unavailable on o/r:");
    expect(redLessons[0]).toContain("nothing the loop commits here is verified");
    expect(redLessons[0]).toContain("`controls.ciHardPass`");
    expect(redLessons[0]).toContain("`verifyMode`");
  });

  it("writes NO recommendation row — an unestablished baseline is not a scan finding", async () => {
    armRed();
    await run();
    // `updateRecommendation` is the only door this module has onto the recommendations table, and
    // every id it touches must be one the run ARMED (`a`). A synthetic "fix your tests" row would
    // show up here as an id nobody armed — and would then be scored, prioritised and reported as
    // though a scan had found it, corrupting the backlog the scan owns.
    const touched = vi.mocked(updateRecommendation).mock.calls.map((c) => c[0]);
    expect(touched.every((id) => id === "a")).toBe(true);
    // Nor is one smuggled in as a deliverable: the lane's only deliverables come from what it moved.
    const headlines = patches.flatMap((p) => ((p.deliverables as { headline: string }[]) ?? [])).map((d) => d.headline);
    expect(headlines.some((h) => /baseline|test:unit/i.test(h))).toBe(false);
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

// ── A LANE VERIFIED AGAINST A NARROWED RUNG ───────────────────────────────────────────────────
//
// A worktree carries no gitignored credentials, service config or local database, so on a realistic
// application the declared command cannot establish a baseline there. The guard degrades to the
// strongest HERMETIC check that can and verifies against that instead — which is worth having, and
// worth being loud about: the lane log, the brief and the persisted row all have to say the tests
// were not run, or the operator reads a compile check as a green suite.
describe("a NARROWED lane", () => {
  beforeEach(() => {
    guard.baseline = {
      resolved: { command: "npm run typecheck", source: "package.json (scripts.typecheck)", rung: "typecheck" },
      passed: true,
      note: null,
      narrowedFrom: { command: "npm run test:unit", source: "package.json (scripts.test:unit)", rung: "primary" },
      triedNarrowed: [],
    };
    guard.outcome = {
      verdict: "verified",
      command: "npm run typecheck",
      rung: "typecheck",
      note: "Verification NARROWED — verified against `npm run typecheck` ONLY …",
      reject: false,
    };
  });

  it("says NARROWED in the lane log, naming both commands", async () => {
    await run();
    const line = logs.find((l) => l.includes("Degradation guard"));
    expect(line).toContain("NARROWED");
    expect(line).toContain("npm run test:unit");
    expect(line).toContain("npm run typecheck");
    expect(line).toContain("the repository's tests are NOT run");
  });

  it("gives the agent the NARROWER promise, never the unqualified one", async () => {
    await run();
    const prompt = (runAgent.mock.calls[0]![0] as unknown as { prompt: string }).prompt;
    expect(prompt).toContain("A NARROWER SAFETY NET");
    expect(prompt).not.toContain("THE SAFETY NET, SO YOU CAN TAKE THE LARGER SWING:");
    expect(prompt).toContain("npm run test:unit");
  });

  it("persists the RUNG beside the verdict, so no reader has to infer it from the command string", async () => {
    const res = await run();
    expect(res.progressed).toBe(true);
    const patch = lastVerifyPatch();
    expect(patch?.verifyVerdict).toBe("verified");
    expect(patch?.verifyRung).toBe("typecheck");
    expect(patch?.verifyCommand).toBe("npm run typecheck");
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
