// AN AGENT THAT WORKED AND DID NOT COMMIT (L2 certification, 2026-08-29) — and what the lane does
// about it now.
//
// The live run this pins: a real `claude -p` session edited files inside the worktree for 5m46s and
// then could not run `git commit` — `--permission-mode acceptEdits` auto-accepts edits but not Bash,
// and headless `-p` has nobody to grant it. The lane logged `0 commit(s) landed this cycle`, which is
// the SAME line a session that found nothing to do produces, and `removeLoopWorktree`'s `--force`
// then deleted the evidence. Nothing anywhere told the operator her agent's work had existed.
//
// THE LANE NOW COMMITS IT (lane-commit.ts). So these cases split in two:
//   • the lane calls the commit step with the armed batch and the agent's summary, always;
//   • when that step FAILS anyway, the honest lost-work log from 2959be4c is still the fallback —
//     it is now the last thing between a failed commit and a silently deleted worktree.

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

/** The lane's commit step, stubbed to FAIL — the fallback path these cases are about. */
const commitFailed = vi.fn(async () => ({
  committed: false,
  files: 3,
  resolved: [] as string[],
  summary: "Could not commit the agent's 3 change(s): fatal: cannot lock ref",
}));

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
      commitWork: commitFailed as never,
      rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: [] })),
      openBatch: vi.fn(async () => [batchItem("a")]),
      ...over,
    },
  });

beforeEach(() => {
  logs.length = 0;
  gitState.porcelain = "";
  commitFailed.mockClear();
});

describe("a backlog lane whose agent committed nothing", () => {
  it("hands the agent's work to the lane's own commit step, with the armed batch", async () => {
    gitState.porcelain = " M src/index.js\n?? AGENTS.md\n";
    await run({ runAgent: vi.fn(async () => ({ ok: true, summary: "wrote AGENTS.md" })) as never });

    expect(commitFailed).toHaveBeenCalledTimes(1);
    const arg = commitFailed.mock.calls[0]![0] as unknown as {
      dir: string;
      branch: string;
      batch: { id: string }[];
      summary: string;
    };
    expect(arg.branch).toBe("ascent/loop-x");
    expect(arg.batch.map((b) => b.id)).toEqual(["a"]);
    expect(arg.summary).toBe("wrote AGENTS.md");
  });

  it("logs why the lane's commit failed, and does not swallow it", async () => {
    gitState.porcelain = " M src/index.js\n";
    await run();
    expect(logs.some((l) => l.includes("cannot lock ref"))).toBe(true);
  });

  it("names the work still uncommitted, the branch it is NOT on, and that it is being discarded", async () => {
    gitState.porcelain = " M src/index.js\n?? AGENTS.md\n?? test/basic.test.js\n";
    await run();

    expect(logs).toContain("0 commit(s) landed this cycle.");
    const warning = logs.find((l) => l.includes("still uncommitted"));
    expect(warning, "the lane said nothing about the work it is about to delete").toBeTruthy();
    expect(warning).toContain("3 change(s)");
    expect(warning).toContain("ascent/loop-x");
    expect(warning).toContain("discarded");
  });

  it("says nothing when the worktree is clean — that session really did find nothing to do", async () => {
    gitState.porcelain = "";
    await run();

    expect(logs).toContain("0 commit(s) landed this cycle.");
    expect(logs.find((l) => l.includes("still uncommitted"))).toBeUndefined();
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
