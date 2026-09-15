// The arithmetic of cents-per-verified-point, pinned once so it cannot drift — plus the STRUCTURAL
// guard that keeps the one-source rule true in code rather than only in a comment.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { driveModelBasis, laneEconomics, pickDriveModel, priceList } from "@/lib/local/lane-economics";
import type { LoopLaneOutcome, LoopLaneRecord } from "@/lib/db/loop-runs-types";

const lane = (over: Partial<LoopLaneRecord> = {}): LoopLaneRecord => ({
  id: "lane-1",
  runId: "run-1",
  repoFullName: "o/r",
  cycle: 1,
  phase: "done",
  branch: "ascent/loop-x",
  batchIds: [],
  closedIds: [],
  commits: 1,
  beforeScanId: "b",
  afterScanId: "a",
  stage: null,
  log: [],
  error: null,
  startedAt: null,
  endedAt: null,
  model: "sonnet",
  costSource: "envelope",
  costMicros: 600,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  turns: null,
  agentDurationMs: null,
  agentSessionId: null,
  abPairKey: null,
  ...over,
});

const scan = { id: "s", overallScore: 50 } as unknown as LoopLaneOutcome["before"];

/** An outcome with a measured pair and the given per-dimension deltas. */
const outcome = (deltas: [string, number | null][], over: Partial<LoopLaneRecord> = {}): LoopLaneOutcome => ({
  lane: lane(over),
  kind: "backlog",
  before: scan,
  after: scan,
  diff: {
    dimensions: deltas.map(([id, delta]) => ({ id, name: id, before: 0, after: delta ?? 0, delta })),
  } as unknown as LoopLaneOutcome["diff"],
  closedFollowUpIds: [],
  commits: 1,
});

/** The same lane with NO measured pair — `diffScans` refuses to invent a delta, and so does this. */
const unmeasured = (over: Partial<LoopLaneRecord> = {}): LoopLaneOutcome => ({
  lane: lane({ afterScanId: null, ...over }),
  kind: "backlog",
  before: scan,
  after: null,
  diff: null,
  closedFollowUpIds: [],
  commits: 1,
});

describe("laneEconomics — one lane's cost against its measured movement", () => {
  it("sums POSITIVE deltas only and divides the cost by them", () => {
    const e = laneEconomics(outcome([["D3", 2], ["D5", 1]]));
    expect(e.verifiedPoints).toBe(3);
    expect(e.microsPerVerifiedPoint).toBe(200);
    expect(e.byDim).toEqual([{ dimId: "D3", delta: 2 }, { dimId: "D5", delta: 1 }]);
    expect(e.unproductive).toBe(false);
  });

  it("does not net a regression off the repair — a broken D5 is not a discount on a fixed D3", () => {
    const e = laneEconomics(outcome([["D3", 2], ["D5", -2]]));
    expect(e.verifiedPoints).toBe(2);
    expect(e.byDim).toEqual([{ dimId: "D3", delta: 2 }]);
    expect(e.microsPerVerifiedPoint).toBe(300);
  });

  it("reports verifiedPoints: null — never 0 — when a scan end is missing", () => {
    const e = laneEconomics(unmeasured());
    expect(e.verifiedPoints).toBeNull();
    expect(e.microsPerVerifiedPoint).toBeNull();
    // Unmeasured is NOT wasteful: nobody established whether this lane moved anything.
    expect(e.unproductive).toBe(false);
  });

  it("calls a lane that spent and measurably moved nothing UNPRODUCTIVE, and prices nothing", () => {
    const e = laneEconomics(outcome([["D3", 0], ["D5", null]]));
    expect(e.verifiedPoints).toBe(0);
    expect(e.unproductive).toBe(true);
    // A division by zero is not an infinitely expensive point; it is no measurement.
    expect(e.microsPerVerifiedPoint).toBeNull();
  });

  it("keeps costMicros null when the CLI reported nothing, and never calls that lane unproductive", () => {
    const e = laneEconomics(outcome([["D3", 0]], { costMicros: null }));
    expect(e.costMicros).toBeNull();
    expect(e.unproductive).toBe(false);
  });
});

describe("priceList — model × dimension, with n on every cell", () => {
  it("attributes a lane's cost to its dimensions in proportion to their deltas", () => {
    const list = priceList([laneEconomics(outcome([["D3", 2], ["D5", 1]]))]);
    const d3 = list.rows.find((r) => r.dimId === "D3")!;
    const d5 = list.rows.find((r) => r.dimId === "D5")!;
    // 600 micro-cents over 3 points: 400 to D3 (2 points), 200 to D5 (1 point).
    expect(d3.totalMicros).toBe(400);
    expect(d5.totalMicros).toBe(200);
    expect(d3.microsPerPoint).toBe(200);
    expect(d5.microsPerPoint).toBe(200);
    expect(d3.n).toBe(1);
  });

  it("counts contributing lanes per cell and averages over their points, not over the lanes", () => {
    const list = priceList([
      laneEconomics(outcome([["D3", 2]], { id: "l1" })),
      laneEconomics(outcome([["D3", 1]], { id: "l2", costMicros: 900 })),
    ]);
    const d3 = list.rows.find((r) => r.dimId === "D3")!;
    expect(d3.n).toBe(2);
    expect(d3.totalPoints).toBe(3);
    expect(d3.totalMicros).toBe(1500);
    expect(d3.microsPerPoint).toBe(500);
  });

  it("keeps unproductive spend OUT of every denominator and states it on its own line", () => {
    const list = priceList([
      laneEconomics(outcome([["D3", 2]], { id: "l1" })),
      laneEconomics(outcome([["D3", 0]], { id: "l2", costMicros: 5_000 })),
    ]);
    expect(list.rows.find((r) => r.dimId === "D3")!.microsPerPoint).toBe(300);
    expect(list.unproductiveMicros).toBe(5_000);
  });

  it("counts a lane with no model, no cost or no measured pair as unpriced rather than as free", () => {
    const list = priceList([
      laneEconomics(outcome([["D3", 2]], { id: "l1", model: null })),
      laneEconomics(outcome([["D3", 2]], { id: "l2", costMicros: null })),
      laneEconomics(unmeasured({ id: "l3" })),
    ]);
    expect(list.rows).toEqual([]);
    expect(list.unpricedLanes).toBe(3);
    expect(list.unproductiveMicros).toBe(0);
  });
});

describe("pickDriveModel — evidence-led, or nothing at all", () => {
  const cell = (model: string, dimId: string, n: number, microsPerPoint: number) => ({
    model,
    dimId,
    n,
    microsPerPoint,
    totalMicros: microsPerPoint * n,
    totalPoints: n,
  });
  const list = (rows: ReturnType<typeof cell>[]): Parameters<typeof pickDriveModel>[0] => ({
    rows,
    unproductiveMicros: 0,
    unpricedLanes: 0,
    generatedAt: "2026-08-30T00:00:00.000Z",
  });

  it("returns the cheaper model when both are measured at n >= minN", () => {
    expect(pickDriveModel(list([cell("sonnet", "D3", 3, 200), cell("opus", "D3", 3, 900)]), ["D3"])).toBe("sonnet");
  });

  it("returns null with only one model measured — 'cheapest of one' is not a choice", () => {
    expect(pickDriveModel(list([cell("sonnet", "D3", 9, 200)]), ["D3"])).toBeNull();
  });

  it("returns null below minN, so a two-lane sample cannot pin the drive to a model", () => {
    expect(pickDriveModel(list([cell("sonnet", "D3", 2, 200), cell("opus", "D3", 2, 900)]), ["D3"])).toBeNull();
  });

  it("returns null when a named dimension has no evidence at all", () => {
    expect(pickDriveModel(list([cell("sonnet", "D3", 3, 200), cell("opus", "D3", 3, 900)]), ["D3", "D9"])).toBeNull();
  });

  it("requires the winner to qualify on EVERY named dimension", () => {
    const rows = [
      cell("sonnet", "D3", 3, 100),
      cell("opus", "D3", 3, 900),
      cell("opus", "D5", 3, 100),
      cell("haiku", "D5", 3, 900),
    ];
    // sonnet is cheapest on D3 and unmeasured on D5; opus is the only model measured on both.
    expect(pickDriveModel(list(rows), ["D3", "D5"])).toBe("opus");
  });

  it("returns null when there is no price list at all", () => {
    expect(pickDriveModel(null, ["D3"])).toBeNull();
  });

  // PRIYA-L1-705: the switch itself was silent — a run armed with a model nobody chose and no record
  // of the evidence that chose it. G18 forbids exactly that: an evidence-led decision that cannot
  // show its evidence is indistinguishable from a guess.
  describe("driveModelBasis — the switch shows its prices and its n", () => {
    it("names the prices compared and the floor they had to clear", () => {
      const basis = driveModelBasis(list([cell("sonnet", "D3", 4, 200), cell("opus", "D3", 3, 900)]), ["D3"], "opus");
      expect(basis).toContain("opus → sonnet");
      expect(basis).toContain("D3");
      // Both prices, each with the thinnest cell it rested on — never the fattest.
      expect(basis).toContain("sonnet 0.00¢/pt (n≥4)");
      expect(basis).toContain("opus 0.00¢/pt (n≥3)");
      expect(basis).toContain("Minimum 3 lanes per cell");
    });

    it("says NOTHING when the evidence agrees with the configured model — that is not a switch", () => {
      expect(driveModelBasis(list([cell("sonnet", "D3", 3, 200), cell("opus", "D3", 3, 900)]), ["D3"], "sonnet")).toBeNull();
    });

    it("says nothing wherever pickDriveModel refuses to choose", () => {
      expect(driveModelBasis(list([cell("sonnet", "D3", 9, 200)]), ["D3"], "opus")).toBeNull();
      expect(driveModelBasis(list([cell("sonnet", "D3", 2, 200), cell("opus", "D3", 2, 900)]), ["D3"], "opus")).toBeNull();
      expect(driveModelBasis(null, ["D3"], "opus")).toBeNull();
    });

    it("lists only the models that qualified on every dimension — never a wider claim than the choice", () => {
      const rows = [
        cell("sonnet", "D3", 3, 100),
        cell("opus", "D3", 3, 900),
        cell("opus", "D5", 3, 100),
        cell("haiku", "D5", 3, 900),
      ];
      const basis = driveModelBasis(list(rows), ["D3", "D5"], "sonnet")!;
      expect(basis).toContain("opus");
      // sonnet is unmeasured on D5 and haiku on D3; neither entered the decision, so neither is
      // reported as having been compared.
      expect(basis).not.toContain("haiku");
      expect(basis).not.toContain("sonnet 0");
    });
  });
});

describe("the one-source rule, structurally", () => {
  // A source-text guard in the spirit of `id-routes-gated.test.ts`. The rule cannot be expressed as a
  // type: `AgentSession.costCents` and `LoopRunLane.costMicros` are both integers, so adding them
  // type-checks perfectly and silently double-counts the same tokens under a better-looking figure.
  // What the guard CAN check is that no read path in the lane's own neighbourhood mentions the OTLP
  // cost field at all — which is the mechanism by which the addition would have to be written.
  const root = join(process.cwd(), "src", "lib");
  const files = [
    ...readdirSync(join(root, "local"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(root, "local", f)),
    join(root, "db", "loop-runs-read.ts"),
  ];

  it("has no read path under src/lib/local/** or in loop-runs-read.ts touching an AgentSession cost", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      // `costCents` is AgentSession's field name; `agentSession` is its Prisma delegate. A lane read
      // that names either is reaching into the other population.
      return /\bcostCents\b/.test(src) || /\bagentSession\s*[.[]/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the lane's own session id a JOIN KEY — it is written, never read into a cost", () => {
    // lane-cost.ts is where the lane's cost write-back lives (extracted from loop-lane.ts).
    const src = readFileSync(join(root, "local", "lane-cost.ts"), "utf8");
    expect(src).toContain("agentSessionId");
    expect(/agentSessionId[^\n]*\+/.test(src)).toBe(false);
  });
});
