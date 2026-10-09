// What a zero-commit lane may record, and what it may not (lane-park.ts).
//
// The safety argument is that nothing here can close or verify a row: each `recordLaneOutcomes` call
// carries `closedIds: []` and a report with no `resolved` item, so `claimedTrailerIds` (the input to
// `closeBuiltCraftRungs`) is empty for it. That is pinned below against the REAL `claimedTrailerIds`.

import { describe, expect, it, vi } from "vitest";
import { claimedTrailerIds } from "@/lib/db/lane-outcomes";
import { containmentParkedDims, isContainmentRefusal, parkWithoutCommits, parkingGroups, type ParkDeps } from "@/lib/local/lane-park";
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

// THE REASONS BLOCK 002 ACTUALLY RECORDED (fragments, verbatim) for the eleven D3/D8/D9 rows its lanes
// refused, under nine different titles for four workflow practices. Every one must read as containment.
const BLOCK_002_CONTAINMENT = [
  "Needs a gate-surface edit to .github/workflows/ai-conformance.yml: add `push: branches: [master]`",
  "Needs a gate-surface edit to .github/workflows/release.yml: give the build job id-token",
  "Needs network to resolve each action tag to a commit SHA, plus gate-surface edits to all 7",
  "means editing existing .github/workflows/*.yml (voids the cycle) and resolving tags to commit SHAs (needs network)",
  "Adding push: branches: [master] and workflow_dispatch: to ai-conformance.yml is an edit to an existing workflow (voids the cycle)",
  "which is an edit to an existing workflow and needs network to pin the new actions.",
  "Every part of the gap is an edit to an existing .github/workflows/*.yml (top-level permissions, ...), and pinning also needs network to resolve SHAs",
  "SHA pins need network to resolve tags and an edit to every existing workflow, and SBOM/provenance need a release.yml edit, all of which void the cycle",
  "are edits to existing workflows that void the cycle; added a vitest ratchet",
  "editing an existing workflow voids the runner cycle, and the app-side opt-in alone would point at a manifest nothing publishes",
];

describe("isContainmentRefusal — the lane's own words for a limit it will always have", () => {
  it("reads every block-002 refusal as containment", () => {
    for (const r of BLOCK_002_CONTAINMENT) expect(isContainmentRefusal(r), r).toBe(true);
    expect(isContainmentRefusal("This session has no shell, so nothing was run")).toBe(true);
  });

  it("does not read a product decision, an already-covered skip or a silent row as containment", () => {
    for (const r of [
      "",
      "Already covered: .github/workflows/codeql.yml runs SAST on push",
      "needs a product decision: which installers do users download?",
      "needs a build run: whether the existing budget is still green cannot be established offline",
      "The existing workflow already scopes its token; nothing to do",
      "a network diagram would help reviewers",
    ]) {
      expect(isContainmentRefusal(r), r).toBe(false);
    }
  });
});

describe("containmentParkedDims — a re-worded gap in a refused dimension stays parked", () => {
  const row = (id: string, dimId: string, reason: string, over: Partial<{ verdict: string; kind: string }> = {}) => ({
    recommendationId: id,
    verdict: over.verdict ?? "needs_human",
    reason,
    dimId,
    kind: over.kind ?? "gap",
  });

  it("parks D9 and D8 from the block-002 refusals and nothing else", () => {
    const dims = containmentParkedDims([
      row("c9286e59", "D9", BLOCK_002_CONTAINMENT[2]!),
      row("728a4c02", "D9", BLOCK_002_CONTAINMENT[3]!),
      row("005be88b", "D8", BLOCK_002_CONTAINMENT[0]!),
      row("d8c8ea3b", "D8", BLOCK_002_CONTAINMENT[4]!),
      row("b94557cc", "D2", "Needs network and a gate-surface edit: Stryker must be installed", { verdict: "skipped", kind: "craft" }),
      row("0e4020df", "D7", "Needs a gate-surface edit: lefthook.yml", { verdict: "skipped", kind: "craft" }),
    ]);
    expect([...dims].sort()).toEqual(["D8", "D9"]);
  });

  it("needs two distinct gap rows: one refusal, or one row recorded twice, parks no dimension", () => {
    expect(containmentParkedDims([row("a", "D9", BLOCK_002_CONTAINMENT[2]!)]).size).toBe(0);
    expect(containmentParkedDims([row("a", "D9", BLOCK_002_CONTAINMENT[2]!), row("a", "D9", BLOCK_002_CONTAINMENT[3]!)]).size).toBe(0);
  });

  it("ignores craft rungs, non-parking verdicts, unknown rows and non-containment reasons", () => {
    const r = BLOCK_002_CONTAINMENT[3]!;
    expect(containmentParkedDims([row("a", "D9", r, { kind: "craft" }), row("b", "D9", r, { kind: "craft" })]).size).toBe(0);
    expect(containmentParkedDims([row("a", "D9", r, { verdict: "attempted" }), row("b", "D9", r, { verdict: "resolved" })]).size).toBe(0);
    expect(containmentParkedDims([{ ...row("a", "D9", r), dimId: null }, { ...row("b", "D9", r), kind: null }]).size).toBe(0);
    expect(containmentParkedDims([row("a", "D9", "needs a product decision"), row("b", "D9", "Already covered by codeql.yml")]).size).toBe(0);
  });
});
