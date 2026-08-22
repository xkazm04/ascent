// Pure-surface coverage for the loop-run persistence layer: the row→record projections (which own
// every JSON-in-TEXT parse in the feature) and the log bound.
//
// The parses are where a malformed column becomes a runtime crash three layers up in a React tree,
// so each one is pinned against the shapes a hand-edited or half-migrated row can actually hold.

import { describe, expect, it } from "vitest";
import { LANE_LOG_LINES, boundLog, toLaneRecord, toRunRecord } from "@/lib/db/loop-runs";

const runRow = (over: Partial<Parameters<typeof toRunRecord>[0]> = {}) => ({
  id: "r1",
  orgId: "o1",
  createdBy: "kazimi66",
  phase: "running",
  reposJson: '["acme/web","acme/api"]',
  concurrency: 2,
  maxCycles: 3,
  cycle: 1,
  curated: true,
  startedAt: new Date("2026-08-22T10:00:00Z"),
  endedAt: null,
  error: null,
  createdAt: new Date("2026-08-22T10:00:00Z"),
  ...over,
});

const laneRow = (over: Partial<Parameters<typeof toLaneRecord>[0]> = {}) => ({
  id: "l1",
  runId: "r1",
  repoFullName: "acme/web",
  cycle: 1,
  phase: "dispatching",
  branch: "ascent/loop-202608221000-acme-web",
  batchIdsJson: '["rec1","rec2"]',
  closedIdsJson: "[]",
  commits: 0,
  beforeScanId: "s0",
  afterScanId: null,
  stage: "analyze",
  log: "10:00:01 armed\n10:00:02 dispatching",
  error: null,
  startedAt: new Date("2026-08-22T10:00:01Z"),
  endedAt: null,
  ...over,
});

describe("toRunRecord", () => {
  it("projects a row, parsing the repo list and ISO-stamping the dates", () => {
    expect(toRunRecord(runRow())).toMatchObject({
      id: "r1",
      phase: "running",
      repos: ["acme/web", "acme/api"],
      cycle: 1,
      curated: true,
      startedAt: "2026-08-22T10:00:00.000Z",
      endedAt: null,
    });
  });

  it("degrades an unparseable / wrong-shaped repos column to an empty list, never a throw", () => {
    expect(toRunRecord(runRow({ reposJson: "not json" })).repos).toEqual([]);
    expect(toRunRecord(runRow({ reposJson: '{"a":1}' })).repos).toEqual([]);
    // A mixed array keeps only the strings — one bad element must not void the whole selection.
    expect(toRunRecord(runRow({ reposJson: '["acme/web",42,null]' })).repos).toEqual(["acme/web"]);
  });
});

describe("toLaneRecord", () => {
  it("splits the log into lines and parses both id lists", () => {
    const lane = toLaneRecord(laneRow());
    expect(lane.log).toEqual(["10:00:01 armed", "10:00:02 dispatching"]);
    expect(lane.batchIds).toEqual(["rec1", "rec2"]);
    expect(lane.closedIds).toEqual([]);
    expect(lane.stage).toBe("analyze");
  });

  it("an empty log is no lines, not one empty line", () => {
    expect(toLaneRecord(laneRow({ log: "" })).log).toEqual([]);
  });
});

describe("boundLog", () => {
  it("keeps the NEWEST lines when the bound is exceeded", () => {
    const lines = Array.from({ length: LANE_LOG_LINES + 25 }, (_, i) => `line ${i}`);
    const bounded = boundLog(lines);
    expect(bounded).toHaveLength(LANE_LOG_LINES);
    expect(bounded[bounded.length - 1]).toBe(`line ${LANE_LOG_LINES + 24}`);
    expect(bounded[0]).toBe("line 25");
  });

  it("is a copy, so a caller cannot mutate the source through it", () => {
    const src = ["a", "b"];
    const out = boundLog(src);
    out.push("c");
    expect(src).toEqual(["a", "b"]);
  });
});
