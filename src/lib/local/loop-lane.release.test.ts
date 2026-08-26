// CLAIM → RUN → ADJUDICATE, with RELEASE on every path the adjudication never ran (2026-08-26).
// Drive #1 died 35 seconds in and left ten of eleven backlog rows claimed (in_progress) — invisible
// to openBatch, kept open by the movement-gated resolve rule, owned by nobody. These pin the rule:
// only a lane whose RESCAN actually ran leaves its claims for the scan feedback to settle.

import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: { id: string; patch: Record<string, unknown>; note: string }[] = [];

vi.mock("@/lib/db/scans-recommendations", () => ({
  updateRecommendation: vi.fn(async (id: string, patch: Record<string, unknown>, meta: { note?: string }) => {
    updates.push({ id, patch, note: meta?.note ?? "" });
    return { id };
  }),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async () => ({})),
  appendLaneLog: vi.fn(async () => {}),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => ({
    ok: true,
    stdout: args[0] === "rev-list" ? "1" : "sha_head",
    stderr: "",
  })),
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

const deps = (over: Partial<LaneDeps> = {}): Partial<LaneDeps> => ({
  runAgent: vi.fn(async () => ({ ok: true, summary: "done" })) as never,
  rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] })),
  openBatch: vi.fn(async () => [batchItem("a"), batchItem("b")]),
  ...over,
});

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", created: true } as never;

const releasesOf = () => updates.filter((u) => u.patch.status === "open");
const claimsOf = () => updates.filter((u) => u.patch.status === "in_progress");

beforeEach(() => {
  updates.length = 0;
});

describe("runLane releases claims when nothing adjudicated them", () => {
  it("keeps claims when the rescan ran — the scan feedback owns them now", async () => {
    const res = await runLane({ runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null, deps: deps() });
    expect(claimsOf().map((u) => u.id)).toEqual(["a", "b"]);
    expect(releasesOf()).toEqual([]);
    expect(res.progressed).toBe(true);
  });

  it("releases when the rescan failed — no adjudication, no zombie", async () => {
    const d = deps({
      rescan: vi.fn(async () => {
        throw new Error("scan exploded");
      }) as never,
    });
    await runLane({ runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null, deps: d });
    expect(releasesOf().map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(releasesOf()[0]!.note).toMatch(/rescan failed, so nothing adjudicated/);
  });

  it("releases when a stop lands between the agent and the rescan", async () => {
    let calls = 0;
    await runLane({
      runId: "run",
      org: "kiro",
      repo: "o/r",
      cycle: 1,
      worktree: wt,
      batch: null,
      deps: deps(),
      // false during the claim phase, true when checked before the rescan
      shouldStop: () => ++calls > 0,
    });
    expect(releasesOf().map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(releasesOf()[0]!.note).toMatch(/stopped before its rescan/);
  });

  it("releases when the agent itself throws", async () => {
    const d = deps({
      runAgent: vi.fn(async () => {
        throw new Error("agent died");
      }) as never,
    });
    const res = await runLane({ runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null, deps: d });
    expect(res.error).toContain("agent died");
    expect(releasesOf().map((u) => u.id).sort()).toEqual(["a", "b"]);
  });
});
