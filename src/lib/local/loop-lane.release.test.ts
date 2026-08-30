// CLAIM → RUN → ADJUDICATE, with RELEASE on every path the adjudication never ran (2026-08-26).
// Drive #1 died 35 seconds in and left ten of eleven backlog rows claimed (in_progress) — invisible
// to openBatch, kept open by the movement-gated resolve rule, owned by nobody. These pin the rule:
// only a lane whose RESCAN actually ran leaves its claims for the scan feedback to settle.

import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: { id: string; patch: Record<string, unknown>; note: string }[] = [];
/** Every `updateLane` patch, so the cost write can be asserted without a database. */
const lanePatches: Record<string, unknown>[] = [];
const metered: Record<string, unknown>[] = [];

vi.mock("@/lib/db/scans-recommendations", () => ({
  updateRecommendation: vi.fn(async (id: string, patch: Record<string, unknown>, meta: { note?: string }) => {
    updates.push({ id, patch, note: meta?.note ?? "" });
    return { id };
  }),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    lanePatches.push(patch);
    return {};
  }),
  appendLaneLog: vi.fn(async () => {}),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
// The meter is FIRE-AND-FORGET by contract (it returns void and swallows its own failures). The
// stub THROWS, so the lane is exercised against the worst thing a mis-wired meter could do.
vi.mock("@/lib/llm/meter", () => ({
  meter: vi.fn((event: Record<string, unknown>) => {
    metered.push(event);
    throw new Error("meter exploded");
  }),
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
  lanePatches.length = 0;
  metered.length = 0;
});

/** The first patch that carried a cost source — the #27 write, wherever in the sequence it landed. */
const costPatch = () => lanePatches.find((p) => "costSource" in p);

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

describe("the lane records what its session cost (moonshot #27)", () => {
  const envelope = (over: Record<string, unknown> = {}) =>
    vi.fn(async () => ({
      ok: true,
      summary: "done",
      model: "claude-opus-4-6",
      costMicros: 62_310_000,
      inputTokens: 1200,
      outputTokens: 800,
      cacheReadTokens: 40_000,
      turns: 4,
      durationMs: 183_402,
      sessionId: "sess_abc",
      ...over,
    })) as never;

  it("stamps ONE declared cost source, the measurements, and the ab pair key", async () => {
    await runLane({
      runId: "run",
      org: "kiro",
      repo: "o/r",
      cycle: 1,
      worktree: wt,
      batch: null,
      abPairKey: "pair-1",
      deps: deps({ runAgent: envelope() }),
    });
    expect(costPatch()).toMatchObject({
      // "envelope" and nothing else: a second value would be a second source, and two sources summed
      // double-count the same tokens.
      costSource: "envelope",
      model: "claude-opus-4-6",
      costMicros: 62_310_000,
      turns: 4,
      agentDurationMs: 183_402,
      agentSessionId: "sess_abc",
      abPairKey: "pair-1",
    });
  });

  it("records a FAILED session's cost and still releases its claims", async () => {
    // The two halves of the same rule: a failure that burned money is the ledger's most important
    // row, and a claim nobody adjudicated is still a zombie.
    await runLane({
      runId: "run",
      org: "kiro",
      repo: "o/r",
      cycle: 1,
      worktree: wt,
      batch: null,
      deps: deps({
        runAgent: envelope({ ok: false, summary: "Agent error (error_max_turns): …", costMicros: 200_000_000 }),
        rescan: vi.fn(async () => {
          throw new Error("scan exploded");
        }) as never,
      }),
    });
    expect(costPatch()).toMatchObject({ costMicros: 200_000_000, costSource: "envelope" });
    expect(releasesOf().map((u) => u.id).sort()).toEqual(["a", "b"]);
  });

  it("writes null — never 0 — for a session that reported nothing", async () => {
    await runLane({
      runId: "run",
      org: "kiro",
      repo: "o/r",
      cycle: 1,
      worktree: wt,
      batch: null,
      deps: deps({ runAgent: vi.fn(async () => ({ ok: true, summary: "done" })) as never }),
    });
    expect(costPatch()).toMatchObject({ costMicros: null, turns: null, model: null, inputTokens: null });
  });

  it("does not fail the lane when the meter throws", async () => {
    // The mocked meter always throws. The lane must still complete and still progress.
    const res = await runLane({
      runId: "run",
      org: "kiro",
      repo: "o/r",
      cycle: 1,
      worktree: wt,
      batch: null,
      deps: deps({ runAgent: envelope() }),
    });
    expect(res.error).toBeNull();
    expect(res.progressed).toBe(true);
    // …and it reached the meter with the caller-owned idempotency key and the lane's own cost,
    // converted from micro-cents to the meter's USD micros.
    expect(metered[0]).toMatchObject({ lane: "local", idemKey: "loop-lane:lane-1", costMicros: 623_100 });
  });
});
