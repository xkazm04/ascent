// AN AGENT THAT WORKED AND DID NOT COMMIT (L2 certification, 2026-08-29).
//
// The live run this pins: a real `claude -p` session edited files inside the worktree for 5m46s and
// then could not run `git commit` — `--permission-mode acceptEdits` auto-accepts edits but not Bash,
// and headless `-p` has nobody to grant it. The lane logged `0 commit(s) landed this cycle`, which is
// the SAME line a session that found nothing to do produces, and `removeLoopWorktree`'s `--force`
// then deleted the evidence. Nothing anywhere told the operator her agent's work had existed.
//
// These cases are about the lane's HONESTY, not about saving the work. Fixing the permission mode is
// a separate decision (recorded as a finding); a lane that cannot distinguish "did nothing" from
// "did everything and lost it" is wrong either way.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
/** What `git status --porcelain` answers in the worktree for the case under test. */
const gitState = { porcelain: "" };

vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async () => ({})),
  appendLaneLog: vi.fn(async (_id: string, line: string) => {
    logs.push(line);
  }),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: readonly string[]) => {
    if (args[0] === "rev-list") return { ok: true, stdout: "0", stderr: "" }; // NO commits landed
    if (args[0] === "status") return { ok: true, stdout: gitState.porcelain, stderr: "" };
    return { ok: true, stdout: "sha_head", stderr: "" };
  }),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {}, isWorkingCopyDirty: vi.fn(async () => false) }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "did things" })) }));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";

const batchItem = (id: string) => ({
  id,
  repo: "o/r",
  title: "t",
  dimId: "D2",
  dimLabel: "Tests",
  impact: "high",
  effort: "low",
  rationale: "r",
  explore: [],
  projectedPoints: 5,
});

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", created: true } as never;

const run = (over: Partial<LaneDeps> = {}) =>
  runLane({
    runId: "run",
    org: "kiro",
    repo: "o/r",
    cycle: 1,
    worktree: wt,
    batch: null,
    deps: {
      runAgent: vi.fn(async () => ({ ok: true, summary: "done" })) as never,
      rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: [] })),
      openBatch: vi.fn(async () => [batchItem("a")]),
      ...over,
    },
  });

beforeEach(() => {
  logs.length = 0;
  gitState.porcelain = "";
});

describe("a backlog lane whose agent committed nothing", () => {
  it("names the uncommitted work, the branch it is NOT on, and that it is being discarded", async () => {
    gitState.porcelain = " M src/index.js\n?? AGENTS.md\n?? test/basic.test.js\n";
    await run();

    expect(logs).toContain("0 commit(s) landed this cycle.");
    const warning = logs.find((l) => l.includes("uncommitted change"));
    expect(warning, "the lane said nothing about the work it is about to delete").toBeTruthy();
    expect(warning).toContain("3 uncommitted change(s)");
    expect(warning).toContain("ascent/loop-x");
    expect(warning).toContain("discarded");
  });

  it("says nothing when the worktree is clean — that session really did find nothing to do", async () => {
    gitState.porcelain = "";
    await run();

    expect(logs).toContain("0 commit(s) landed this cycle.");
    expect(logs.find((l) => l.includes("uncommitted change"))).toBeUndefined();
  });

  it("gives the agent's own first line room to explain itself", async () => {
    // The live failure's reason arrived 190 characters in and was cut at 160, mid-word.
    const reason =
      "All work is complete in the working tree but I'm unable to run `git add` / `git commit` in this session " +
      "because write git operations are blocked by the approval policy, so nothing has been committed to the branch.";
    await run({ runAgent: vi.fn(async () => ({ ok: true, summary: reason })) as never });

    const line = logs.find((l) => l.startsWith("Agent finished:"));
    expect(line).toBeTruthy();
    expect(line, "the reason was truncated before it became readable").toContain("blocked by the approval policy");
  });
});
