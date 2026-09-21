// THE PLANNING SESSION'S TOKENS, ON THE ROW (spark local-model-lanes, WP9).
//
// The optimized metric of this feature is CLAUDE TOKENS PER VERIFIED POINT. A split arm — Claude
// plans, a local model executes — spends every one of those Claude tokens in the planning session,
// and the lane row used to record only the executing one. The comparison therefore reported the arm
// this feature advocates as costing ZERO Claude tokens: wrong, and flattering, which is the worst
// combination. This suite pins the whole path — the migration's shape, the patch that writes the
// columns, the projection that reads them, and the null a lane that never planned keeps.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toLaneRecord } from "@/lib/db/loop-runs-types";
import { laneTokenAttribution, type LaneMetricRow } from "@/lib/local/compare-metrics";

const MIGRATION = join(process.cwd(), "prisma", "migrations", "20260921150000_add_lane_plan_tokens", "migration.sql");

vi.mock("@/lib/llm/meter", () => ({ meter: () => undefined }));
vi.mock("@/lib/db/loop-runs", () => ({
  updateLane: vi.fn(async () => null),
  appendLaneLog: vi.fn(async () => null),
}));
vi.mock("@/lib/db/usage-events", () => ({ defaultOwnerTeamForRepo: async () => null }));
vi.mock("@/lib/local/transport/profile", () => ({
  transportProfile: (id: string) => ({
    id,
    label: id,
    bin: id,
    timing: { agentMs: 1, planMs: 1, quietMs: 1 },
    zeroCost: id !== "claude",
    caps: { streamJson: null, editStance: null, planStance: null, resume: null, promptOnStdin: null },
  }),
}));

const { laneArmPatch, planTokenColumns } = await import("./lane-cost");

/** One session's envelope, as `AgentRunResult` carries it. */
const result = (over: Record<string, unknown> = {}) => ({
  ok: true,
  summary: "",
  errorText: "",
  model: "sonnet",
  sessionId: "s1",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 10,
  turns: 3,
  durationMs: 1000,
  costMicros: 500,
  ...over,
});

const laneRow = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  runId: "r1",
  repoFullName: "a/b",
  cycle: 1,
  phase: "done",
  branch: null,
  batchIdsJson: "[]",
  closedIdsJson: "[]",
  commits: 1,
  beforeScanId: null,
  afterScanId: null,
  stage: null,
  log: "",
  error: null,
  startedAt: null,
  endedAt: null,
  ...over,
});

describe("the migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("is five nullable INTEGER columns — no NOT NULL, no DEFAULT, no backfill", () => {
    const adds = sql.split("\n").filter((l) => l.trim().startsWith("ALTER TABLE"));
    expect(adds).toHaveLength(5);
    for (const line of adds) {
      expect(line).toMatch(/ADD COLUMN "[A-Za-z]+" INTEGER;\s*$/);
      expect(line).not.toMatch(/NOT NULL|DEFAULT/);
    }
    // A backfill is what would turn "this lane's planning cost is unknown" into "it was free".
    expect(sql).not.toMatch(/UPDATE |INSERT /);
  });

  it("names exactly the five columns, and repurposes none of the executing session's", () => {
    for (const col of ["planInputTokens", "planOutputTokens", "planCacheReadTokens", "planTurns", "planDurationMs"]) {
      expect(sql).toContain(`ADD COLUMN "${col}" INTEGER;`);
    }
    for (const col of ["inputTokens", "outputTokens", "cacheReadTokens", "turns", "agentDurationMs"]) {
      expect(sql).not.toContain(`ADD COLUMN "${col}"`);
    }
  });

  it("is mirrored into the bootstrap SQL, both as a column and as an idempotent ALTER", () => {
    const init = readFileSync(join(process.cwd(), "prisma", "init.sql"), "utf8");
    for (const col of ["planInputTokens", "planOutputTokens", "planCacheReadTokens", "planTurns", "planDurationMs"]) {
      expect(init).toContain(`    "${col}" INTEGER,`);
      expect(init).toContain(`ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "${col}" INTEGER;`);
    }
  });
});

describe("a lane written before the columns", () => {
  it("reads back with an UNKNOWN planning cost — null on every field, never 0", () => {
    const rec = toLaneRecord(laneRow({ inputTokens: 900, outputTokens: 300 }));
    expect(rec.planInputTokens).toBeNull();
    expect(rec.planOutputTokens).toBeNull();
    expect(rec.planCacheReadTokens).toBeNull();
    expect(rec.planTurns).toBeNull();
    expect(rec.planDurationMs).toBeNull();
    // What it DID record is untouched: the executing session keeps its columns exactly.
    expect(rec.inputTokens).toBe(900);
    expect(rec.outputTokens).toBe(300);
  });

  it("reads a lane that DID record both halves back as two separate sessions", () => {
    const rec = toLaneRecord(
      laneRow({ inputTokens: 900, outputTokens: 300, planInputTokens: 80, planOutputTokens: 40, planTurns: 2 }),
    );
    expect(rec).toMatchObject({
      inputTokens: 900,
      outputTokens: 300,
      planInputTokens: 80,
      planOutputTokens: 40,
      planTurns: 2,
    });
  });
});

describe("laneArmPatch", () => {
  const splitSteps = () => [
    {
      step: "plan" as const,
      transport: "claude" as const,
      model: "sonnet",
      result: result({ inputTokens: 80, outputTokens: 40, turns: 2, durationMs: 4000 }),
    },
    {
      step: "execute" as const,
      transport: "pi" as const,
      model: "qwen3.8:27b",
      result: result({ inputTokens: 900, outputTokens: 300, turns: 9, durationMs: 60000 }),
    },
  ];

  it("records the plan half in its own columns and the execute half in the existing ones", () => {
    const { patch } = laneArmPatch(splitSteps());
    expect(patch.planInputTokens).toBe(80);
    expect(patch.planOutputTokens).toBe(40);
    expect(patch.planTurns).toBe(2);
    expect(patch.planDurationMs).toBe(4000);
    // Byte-identical meaning for the executing columns — they are NOT repurposed.
    expect(patch.inputTokens).toBe(900);
    expect(patch.outputTokens).toBe(300);
    expect(patch.turns).toBe(9);
    expect(patch.agentDurationMs).toBe(60000);
  });

  it("writes NULL, not 0, for a lane that never planned", () => {
    const { patch } = laneArmPatch([
      { step: "execute" as const, transport: "claude" as const, model: "sonnet", result: result() },
    ]);
    expect(patch.planInputTokens).toBeNull();
    expect(patch.planOutputTokens).toBeNull();
    expect(patch.planCacheReadTokens).toBeNull();
    expect(patch.planTurns).toBeNull();
    expect(patch.planDurationMs).toBeNull();
  });

  it("keeps a planning session that reported nothing as unknown per field", () => {
    expect(
      planTokenColumns({ inputTokens: null, outputTokens: null, cacheReadTokens: null, turns: null, durationMs: null, costMicros: null }),
    ).toEqual({
      planInputTokens: null,
      planOutputTokens: null,
      planCacheReadTokens: null,
      planTurns: null,
      planDurationMs: null,
    });
  });
});

describe("laneTokenAttribution — the projection the optimized metric reads", () => {
  const base: LaneMetricRow = { laneId: "l1", armId: "split", transport: "pi", outcome: "landed" };

  it("gives a split arm's CLAUDE tokens as the PLAN side alone", () => {
    const split = laneTokenAttribution({
      ...base,
      planTransport: "claude",
      inputTokens: 900,
      outputTokens: 300,
      planInputTokens: 80,
      planOutputTokens: 40,
    });
    expect(split).toEqual({ claudeTokens: 120, localTokens: 1200 });
  });

  it("gives an all-Claude lane both halves as Claude and nothing to local", () => {
    const split = laneTokenAttribution({
      ...base,
      armId: "claude",
      transport: "claude",
      inputTokens: 900,
      outputTokens: 300,
      planInputTokens: 80,
      planOutputTokens: 40,
    });
    expect(split).toEqual({ claudeTokens: 1320, localTokens: null });
  });

  it("gives an all-local lane nothing on the Claude side — null, not 0", () => {
    const split = laneTokenAttribution({
      ...base,
      inputTokens: 900,
      outputTokens: 300,
      planInputTokens: 10,
      planOutputTokens: 5,
    });
    expect(split).toEqual({ claudeTokens: null, localTokens: 1215 });
  });

  it("sums two unknown counts to null rather than 0", () => {
    expect(laneTokenAttribution({ ...base, transport: "claude" })).toEqual({ claudeTokens: null, localTokens: null });
  });

  it("still over-attributes when a Claude planner's tokens were never recorded", () => {
    // The one conservatism left, and it is narrow: an unmeasured Claude planner must not read as
    // zero Claude spend on the arm this feature is advocating for.
    expect(laneTokenAttribution({ ...base, planTransport: "claude", inputTokens: 300, outputTokens: 200 })).toEqual({
      claudeTokens: 500,
      localTokens: null,
    });
  });

  it("honours an explicit per-side split over the columns", () => {
    expect(
      laneTokenAttribution({
        ...base,
        planTransport: "claude",
        inputTokens: 900,
        outputTokens: 300,
        claudeTokens: 7,
        localTokens: 9,
      }),
    ).toEqual({ claudeTokens: 7, localTokens: 9 });
  });
});
