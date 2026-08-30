// A LANE THAT COMMITTED NOTHING DOES NOT RESCAN (L2-B-01, 2026-08-29).
//
// The loop scans a lane's WORKTREE — a temp checkout `removeLoopWorktree` deletes on the way out —
// so that scan describes the repository only for what the lane committed. The L2 run's agent lane
// committed nothing, rescanned anyway, and the resulting scan became `bare-svc`'s LATEST reading: the
// cockpit printed `▲+24 ATTRIBUTABLE LIFT` beside `0 commits` three lines apart, and the fleet's
// greenness and debt inherited a standard that existed nowhere on disk.
//
// The gate is at the source — no commit, no scan, nothing to adopt — and the claims are released,
// because a rescan is the only thing that ever adjudicates them.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
const recUpdates: { id: string; status: unknown; note: string }[] = [];
const git = { commits: "0" };

vi.mock("@/lib/db/scans-recommendations", () => ({
  updateRecommendation: vi.fn(async (id: string, patch: Record<string, unknown>, meta: { note?: string }) => {
    recUpdates.push({ id, status: patch.status, note: meta?.note ?? "" });
    return { id };
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
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: readonly string[]) => {
    if (args[0] === "rev-list") return { ok: true, stdout: git.commits, stderr: "" };
    if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
    return { ok: true, stdout: "sha_head", stderr: "" };
  }),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "did things" })) }));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";

const item = (id: string) => ({
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

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/paired" };
const rescan = vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] }));

const run = (over: Partial<LaneDeps> = {}) =>
  runLane({
    runId: "run",
    org: "kiro",
    repo: "o/r",
    cycle: 1,
    worktree: wt as never,
    batch: null,
    deps: {
      runAgent: vi.fn(async () => ({ ok: true, summary: "done" })) as never,
      commitWork: vi.fn(async () => ({ committed: false, files: 0, resolved: [], summary: "nothing to commit" })) as never,
      rescan: rescan as never,
      openBatch: vi.fn(async () => [item("a"), item("b")]),
      ...over,
    },
  });

beforeEach(() => {
  logs.length = 0;
  recUpdates.length = 0;
  rescan.mockClear();
  git.commits = "0";
});

describe("a lane that committed nothing", () => {
  it("does not rescan, so nothing it measured can become the repo's standing scan", async () => {
    const res = await run();
    expect(rescan).not.toHaveBeenCalled();
    expect(res.commits).toBe(0);
    expect(res.closed).toBe(0);
    expect(res.progressed).toBe(false);
    expect(res.error).toBeNull();
  });

  it("says why, in the operator's terms, rather than reading as a lane that failed", async () => {
    await run();
    const line = logs.find((l) => l.includes("No commits, so no rescan"));
    expect(line).toBeTruthy();
    expect(line).toContain("credit the repo with work that does not exist");
  });

  it("releases every claim it made — a rescan is the only thing that adjudicates them", async () => {
    await run();
    const released = recUpdates.filter((u) => u.status === "open");
    expect(released.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(released[0]!.note).toContain("committed nothing");
  });
});

describe("a lane that did commit", () => {
  it("rescans exactly as before — the gate is on commits, not on the lane kind", async () => {
    git.commits = "2";
    const res = await run();
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(res.commits).toBe(2);
    expect(res.closed).toBe(1);
    expect(res.progressed).toBe(true);
    // The claim is left for the scan feedback to settle, NOT released.
    expect(recUpdates.filter((u) => u.status === "open")).toEqual([]);
  });
});
