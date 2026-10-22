// The sandbox commit's extent, shown before it writes (roadmap-1, remediation-roadmaps /
// sandbox-to-tracker-commit): every applied item is either STARTED, SKIPPED with the status that
// stops it, or UNMATCHED (no persisted rec for this scan). After the one POST, each started row reads
// tracked, held, not-open or failed: a partial commit names its rows instead of giving a count.

import { describe, it, expect } from "vitest";
import type { LlmRoadmapItem, PersistedRecommendation } from "@/lib/types";
import { commitOutcomeRows, planSandboxCommit, summarizeCommitOutcome, summarizeSandboxPlan } from "./sandboxCommitModel";

function rec(over: Partial<PersistedRecommendation>): PersistedRecommendation {
  return {
    id: "x",
    title: "",
    dimension: "D1",
    impact: "high",
    effort: "low",
    rationale: "",
    explore: [],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...over,
  } as PersistedRecommendation;
}

const roadmap = [
  { dimension: "D1", title: "Add agent guidance" },
  { dimension: "D2", title: "Improve docs" },
  { dimension: "D3", title: "Add coverage gate" },
  { dimension: "D4", title: "Nothing persisted for this one" },
] as unknown as LlmRoadmapItem[];

const A = rec({ id: "A", dimension: "D1", title: "Add agent guidance", status: "open" });
const B = rec({ id: "B", dimension: "D2", title: "Improve docs", status: "in_progress", assigneeLogin: "ana" });
const C = rec({ id: "C", dimension: "D3", title: "Add coverage gate", status: "done" });
const recs = [A, B, C];

describe("planSandboxCommit: start / skip with status / unmatched", () => {
  it("splits the applied items into what it will start, what it skips and why, and what is not tracked", () => {
    const plan = planSandboxCommit(roadmap, recs, new Set([0, 1, 2, 3]));
    expect(plan.start.map((r) => r.id)).toEqual(["A"]);
    expect(plan.skip.map((s) => ({ id: s.rec.id, status: s.status }))).toEqual([
      { id: "B", status: "in_progress" },
      { id: "C", status: "done" },
    ]);
    expect(plan.skip[0]!.rec.assigneeLogin).toBe("ana");
    expect(plan.unmatched).toEqual([roadmap[3]]);
  });

  it("two applied items joining the same open rec start it once", () => {
    const twin = [roadmap[0]!, { dimension: "D1", title: "add  agent guidance!" }] as unknown as LlmRoadmapItem[];
    const plan = planSandboxCommit(twin, [A], new Set([0, 1]));
    expect(plan.start.map((r) => r.id)).toEqual(["A"]);
    expect(plan.skip).toEqual([]);
  });

  it("no persisted recs: every applied item is unmatched and nothing starts", () => {
    const plan = planSandboxCommit(roadmap, null, new Set([0, 1]));
    expect(plan.start).toEqual([]);
    expect(plan.unmatched).toHaveLength(2);
  });
});

describe("summarizeSandboxPlan: the extent in one line", () => {
  it("names the start, the skip breakdown by status, and the untracked count", () => {
    const plan = planSandboxCommit(roadmap, recs, new Set([0, 1, 2, 3]));
    expect(summarizeSandboxPlan(plan)).toBe(
      "Start 1 · 2 already on the tracker (1 in progress, 1 done) · 1 not tracked for this scan",
    );
  });

  it("an empty start still carries the breakdown, never the old conflated reason", () => {
    const plan = planSandboxCommit(roadmap, recs, new Set([1, 3]));
    const line = summarizeSandboxPlan(plan);
    expect(line).toBe("Nothing new to start · 1 already on the tracker (1 in progress) · 1 not tracked for this scan");
    expect(line).not.toContain("or have no persisted match");
    expect(line).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("commitOutcomeRows: each started row reads its own outcome", () => {
  it("marked -> tracked, skipped -> its reason, a start id in neither list -> failed", () => {
    const plan = { start: [A, rec({ id: "B2", title: "b2" }), rec({ id: "Z", title: "z" })], skip: [], unmatched: [] };
    const rows = commitOutcomeRows(plan, { marked: ["A"], skipped: [{ id: "B2", reason: "held" }] });
    expect(rows.map((r) => [r.id, r.outcome])).toEqual([
      ["A", "tracked"],
      ["B2", "held"],
      ["Z", "failed"],
    ]);
  });

  it("the summary is built from those rows and names held and failed apart", () => {
    const plan = { start: [A, rec({ id: "B2" }), rec({ id: "Z" })], skip: [], unmatched: [] };
    const line = summarizeCommitOutcome(
      commitOutcomeRows(plan, { marked: ["A"], skipped: [{ id: "B2", reason: "held" }] }),
    );
    expect(line).toContain("1 of 3 recommendations marked in progress.");
    expect(line).toContain("1 already taken by someone else");
    expect(line).toContain("1 couldn't be saved and stayed open");
    expect(line).not.toContain(String.fromCharCode(0x2014));
  });
});
