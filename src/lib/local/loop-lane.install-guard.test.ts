// THE GUARD ON AN INSTALL LANE, and the diff the agent lane's verdict is now about.
//
// An install lane used to record NO verdict, so the runner (which lands only `verified`) never landed
// one and every round re-installed the same starter. These pin the wiring: a baseline before the
// install, a verdict over exactly the committed files, a reversal that resets the committed install,
// and the "switched off" note when the guard is off. The REAL `verifyResult` runs unless a case pins
// an outcome, so the inert-diff upgrade is exercised end to end.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const patches: Record<string, unknown>[] = [];
const gitCalls: (readonly string[])[] = [];

const ctl = vi.hoisted(() => ({
  baseline: null as unknown,
  outcome: null as unknown,
  resultArgs: [] as unknown[][],
  baselineCalls: 0,
  diff: [] as string[],
  untracked: [] as string[],
}));

vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[]) => ids.length),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => void patches.push(patch)),
  appendLaneLog: vi.fn(async (_id: string, line: string) => void logs.push(line)),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/loop-lessons", () => ({ recordLoopLessons: vi.fn(async () => []), recordRedBaselineLesson: vi.fn(async () => null) }));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: readonly string[]) => {
    gitCalls.push(args);
    if (args[0] === "rev-list") return { ok: true, stdout: "1", stderr: "" };
    if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
    if (args[0] === "ls-files") return { ok: true, stdout: ctl.untracked.join("\0"), stderr: "" };
    // The guard's diff (`-z`) vs the integrity guard's `before..HEAD` read, which must stay clean here.
    if (args[0] === "diff") return { ok: true, stdout: args.includes("-z") ? ctl.diff.join("\0") : "", stderr: "" };
    return { ok: true, stdout: "sha_before", stderr: "" };
  }),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {}, isWorkingCopyDirty: vi.fn(async () => false) }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "did things" })) }));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
vi.mock("@/lib/local/lane-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/lane-guard")>();
  return {
    ...actual,
    verifyBaseline: vi.fn(async () => {
      ctl.baselineCalls += 1;
      return ctl.baseline;
    }),
    verifyResult: vi.fn(async (...a: Parameters<typeof actual.verifyResult>) => {
      ctl.resultArgs.push(a);
      return (ctl.outcome as Awaited<ReturnType<typeof actual.verifyResult>> | null) ?? actual.verifyResult(...a);
    }),
  };
});

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { NO_VERIFY_BASELINE } from "@/lib/local/lane-guard";

const wt = { dir: "C:/tmp/wt-install", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;
const rescan = vi.fn(async () => ({ scanId: "scan-after", closedIds: [] }));
const commitWork = vi.fn(async () => ({ committed: true, files: 1, resolved: [], summary: "committed" }));
const install = vi.fn(async () => ({ ok: true, written: ["docs/AI_HARNESS.md", ".github/pull_request_template.md"], skipped: [], committed: true, summary: "Installed 2 file(s)." }));

const run = (over: Record<string, unknown> = {}) =>
  runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null, kind: "foundation",
    deps: {
      install: install as never,
      runAgent: vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - did it" })) as never,
      commitWork: commitWork as never,
      rescan,
      openBatch: vi.fn(async () => [{ id: "a", repo: "o/r", title: "t", dimId: "D2", dimLabel: "Tests", impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5 }]),
      loadBrief: vi.fn(async () => null) as never,
      readReport: vi.fn(async () => null) as never,
      loadPair: vi.fn(async () => null),
      summarize: vi.fn(async (l) => l),
      priorBaselines: vi.fn(async () => []),
    } as Partial<LaneDeps>,
    ...over,
  } as Parameters<typeof runLane>[0]);

const lastVerifyPatch = () => [...patches].reverse().find((p) => "verifyVerdict" in p);
const PASSING = { resolved: { command: "npm run check:ci", source: "package.json", rung: "primary" }, passed: true, note: null, narrowedFrom: null, triedNarrowed: [] };

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  gitCalls.length = 0;
  ctl.baseline = NO_VERIFY_BASELINE;
  ctl.outcome = null;
  ctl.resultArgs = [];
  ctl.baselineCalls = 0;
  ctl.diff = [];
  ctl.untracked = [];
  rescan.mockClear();
  install.mockClear();
});

describe("an install lane", () => {
  it("measures the baseline BEFORE installing, and judges exactly the files it committed", async () => {
    let installedAfterBaseline = false;
    install.mockImplementationOnce(async () => {
      installedAfterBaseline = ctl.baselineCalls === 1;
      return { ok: true, written: ["README.md"], skipped: [], committed: true, summary: "Installed 1 file(s)." };
    });
    await run();
    expect(installedAfterBaseline).toBe(true);
    expect(ctl.resultArgs[0]?.[4]).toEqual(["README.md"]);
  });

  it("an ALL-INERT install on a repo with no resolvable check records `verified` — by construction — and proceeds", async () => {
    await run();
    const patch = lastVerifyPatch();
    expect(patch?.verifyVerdict).toBe("verified");
    expect(patch?.verifyCommand).toBeNull();
    expect(String(patch?.verifyNote)).toMatch(/^Verified by construction:/);
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("an install touching a NON-inert file on a no-check repo stays `skipped`", async () => {
    install.mockImplementationOnce(async () => ({ ok: true, written: [".ai/doctor.mjs", "README.md"], skipped: [], committed: true, summary: "Installed 2 file(s)." }));
    await run();
    expect(lastVerifyPatch()?.verifyVerdict).toBe("skipped");
  });

  it("a REJECTED install resets the committed install, records the reversal, and does not rescan", async () => {
    ctl.baseline = PASSING;
    ctl.outcome = { verdict: "rejected", command: "npm run check:ci", rung: "primary", note: "Verification REJECTED … First failure:\nboom", reject: true };
    install.mockImplementationOnce(async () => ({ ok: true, written: [".ai/doctor.mjs"], skipped: [], committed: true, summary: "Installed 1 file(s)." }));
    const res = await run();
    expect(gitCalls).toContainEqual(["reset", "--hard", "sha_before"]);
    expect(lastVerifyPatch()?.verifyVerdict).toBe("rejected");
    const rows = patches.find((p) => Array.isArray(p.deliverables))?.deliverables as { headline: string; covers: string[] }[];
    expect(rows[0]!.headline).toMatch(/discarded/i);
    expect(rows[0]!.covers).toEqual([]);
    expect(rescan).not.toHaveBeenCalled();
    expect(res.progressed).toBe(false);
  });

  it("with the guard OFF, measures nothing and records `skipped` with the switched-off note", async () => {
    await run({ verify: { enabled: false } });
    expect(ctl.baselineCalls).toBe(0);
    expect(ctl.resultArgs).toHaveLength(0);
    expect(lastVerifyPatch()?.verifyVerdict).toBe("skipped");
    expect(String(lastVerifyPatch()?.verifyNote)).toContain("switched off");
  });
});

describe("an agent lane's verdict", () => {
  it("is judged over its uncommitted + adopted diff, minus the lane's own report", async () => {
    ctl.diff = ["README.md"];
    ctl.untracked = [".ascent/lane-report.json", "docs/notes.md"];
    await run({ kind: "backlog" });
    expect(ctl.resultArgs[0]?.[4]).toEqual(["README.md", "docs/notes.md"]);
    expect(gitCalls).toContainEqual(["diff", "--name-only", "--no-renames", "-z", "sha_before"]);
    expect(lastVerifyPatch()?.verifyVerdict).toBe("verified");
  });

  it("keeps the old verdict when any edit is not inert", async () => {
    ctl.diff = ["README.md", "src/index.ts"];
    await run({ kind: "backlog" });
    expect(lastVerifyPatch()?.verifyVerdict).toBe("skipped");
  });
});
