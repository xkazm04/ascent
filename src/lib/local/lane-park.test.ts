// What a zero-commit lane may record, and what it may not (lane-park.ts).
//
// The safety argument is that nothing here can close or verify a row: each `recordLaneOutcomes` call
// carries `closedIds: []` and a report with no `resolved` item, so `claimedTrailerIds` (the input to
// `closeBuiltCraftRungs`) is empty for it. That is pinned below against the REAL `claimedTrailerIds`.

import { describe, expect, it, vi } from "vitest";
import { claimedTrailerIds } from "@/lib/db/lane-outcomes";
import { parkWithoutCommits, parkingGroups, type ParkDeps } from "@/lib/local/lane-park";
import type { LaneReport, LaneVerdict } from "@/lib/local/lane-report";

const item = (id: string, verdict: LaneVerdict, reason = `why ${id}`) => ({ recommendationId: id, verdict, reason, files: [] });
const report = (items: LaneReport["items"], lessons: string[] = []): LaneReport => ({ v: 1, parsed: true, items, lessons });

const BLOCK_001 = report(
  [item("ci-trigger", "skipped"), item("pin-actions", "skipped"), item("sbom", "skipped")],
  ["only an edit to existing workflows closes these", "validate-workflows.mjs is the gate", "release steps live in release.yml"],
);

describe("parkingGroups", () => {
  it("groups the block-001 lane's three skips into one skipped group, lessons stripped", () => {
    const g = parkingGroups(["ci-trigger", "pin-actions", "sbom"], BLOCK_001);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ verdict: "skipped", ids: ["ci-trigger", "pin-actions", "sbom"] });
    expect(g[0]!.report.lessons).toEqual([]);
  });

  it("never records a resolved, attempted or absent verdict, and ignores ids outside the batch", () => {
    const r = report([item("a", "resolved"), item("b", "attempted"), item("c", "needs_human"), item("d", "skipped"), item("stranger", "skipped")]);
    const g = parkingGroups(["a", "b", "c", "d"], r);
    expect(g.map((x) => [x.verdict, x.ids])).toEqual([
      ["skipped", ["d"]],
      ["needs_human", ["c"]],
    ]);
  });

  it("parks nothing on a missing or unparsed report", () => {
    expect(parkingGroups(["a"], null)).toEqual([]);
    expect(parkingGroups(["a"], { v: 1, parsed: false, items: [item("a", "skipped")], lessons: [] })).toEqual([]);
  });

  it("can never hand closeBuiltCraftRungs an id: claimedTrailerIds is empty for every group", () => {
    const mixed = report([item("r", "resolved"), item("s1", "skipped"), item("s2", "skipped"), item("h1", "needs_human"), item("x", "attempted")]);
    const batch = ["r", "s1", "s2", "h1", "x", "absent-one"];
    const groups = parkingGroups(batch, mixed);
    expect(groups.length).toBe(2);
    for (const g of groups) expect(claimedTrailerIds(g.ids, g.report)).toEqual([]);
    // The contrast that makes the split necessary: the WHOLE batch would claim trailers.
    expect(claimedTrailerIds(batch, mixed)).not.toEqual([]);
  });
});

describe("parkWithoutCommits", () => {
  const deps = (over: Partial<ParkDeps> = {}) => ({
    recordLaneOutcomes: vi.fn(async () => []),
    recordLoopLessons: vi.fn(async (_o: string, _r: string, _l: string, list: readonly string[]) => list.map((x) => x)),
    log: vi.fn(async () => undefined),
    ...over,
  });
  const args = { org: "kiro", repo: "xkazm04/personas", runId: "run-1", laneId: "lane-1", cycle: 1, batchIds: ["ci-trigger", "pin-actions", "sbom"] };

  it("records the skips with closedIds [] and the lessons as candidates only (autoKeep false)", async () => {
    const d = deps();
    const out = await parkWithoutCommits({ ...args, report: BLOCK_001 }, d);
    expect(out).toEqual({ parked: ["ci-trigger", "pin-actions", "sbom"], lessons: 3 });
    expect(d.recordLaneOutcomes).toHaveBeenCalledTimes(1);
    expect(d.recordLaneOutcomes).toHaveBeenCalledWith(expect.objectContaining({ batchIds: ["ci-trigger", "pin-actions", "sbom"], closedIds: [], cycle: 1, runId: "run-1", laneId: "lane-1" }));
    expect(d.recordLoopLessons).toHaveBeenCalledWith("kiro", "xkazm04/personas", "lane-1", BLOCK_001.lessons, { autoKeep: false });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("Parked 3 item(s)"));
  });

  it("never throws, even when the outcome write does", async () => {
    const d = deps({ recordLaneOutcomes: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(parkWithoutCommits({ ...args, report: BLOCK_001 }, d)).resolves.toEqual({ parked: [], lessons: 0 });
  });

  it("writes nothing for a session that resolved or attempted everything", async () => {
    const d = deps();
    await parkWithoutCommits({ ...args, report: report([item("ci-trigger", "resolved"), item("sbom", "attempted")]) }, d);
    expect(d.recordLaneOutcomes).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });
});
