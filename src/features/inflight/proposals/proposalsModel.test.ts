// The Proposals queue's model: which loop rows count as pending, how a gap proposed twice is judged
// by its latest appearance, and how the follow-ups filters apply to a row that has no impact rating.

import { describe, expect, it } from "vitest";
import type { LoopRunDetail } from "@/lib/db/loop-runs-types";
import { emptyFilters, type FollowUpRow } from "@/components/org/followups/followupsModel";
import { applyProposalFilters, mergeProposals, pendingLoopProposals, type ProposalRow } from "./proposalsModel";

/** A run whose one lane armed `batchIds` and resolved none of them — every item is `proposed`. */
function run(id: string, startedAt: string, batchIds: string[], review?: { cover: string; verdict: "approved" | "dismissed" }): LoopRunDetail {
  const deliverables = review ? [{ headline: review.cover, dimId: null, kind: "noted", covers: [review.cover], evidence: null, review: { verdict: review.verdict } }] : [];
  return {
    run: { id, startedAt },
    outcomes: [
      {
        lane: { id: `${id}-lane`, repoFullName: "acme/web", batchIds },
        deliverables,
        commits: 0,
        closedFollowUpIds: [],
        before: { recommendations: batchIds.map((b) => ({ id: b, title: `Fix ${b}` })) },
        after: null,
      },
    ],
  } as unknown as LoopRunDetail;
}

const followUp = (over: Partial<FollowUpRow> = {}): FollowUpRow =>
  ({
    id: "rec-9",
    repo: "acme/api",
    repoName: "api",
    title: "Add CODEOWNERS",
    dimId: "D6",
    dimLabel: "Governance",
    impact: "high",
    effort: "low",
    rationale: "",
    explore: [],
    projectedPoints: 4,
    status: "open",
    lastActivityAt: "2026-09-10T00:00:00.000Z",
    unlocks: null,
    assigneeLogin: null,
    ...over,
  }) as FollowUpRow;

describe("pendingLoopProposals", () => {
  it("lists every armed-but-unresolved batch item, addressed by lane and cover", () => {
    const rows = pendingLoopProposals([run("r1", "2026-09-01T00:00:00Z", ["rec-1", "rec-2"])]);
    expect(rows.map((r) => [r.title, r.laneId, r.cover, r.repoName])).toEqual([
      ["Fix rec-1", "r1-lane", "rec-1", "web"],
      ["Fix rec-2", "r1-lane", "rec-2", "web"],
    ]);
    expect(rows.every((r) => r.source === "loop" && r.state === "proposed")).toBe(true);
  });

  it("judges a gap by its latest run: one row, from the newest run", () => {
    const rows = pendingLoopProposals([run("old", "2026-09-01T00:00:00Z", ["rec-1"]), run("new", "2026-09-05T00:00:00Z", ["rec-1"])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.runId).toBe("new");
  });

  it("drops a gap an owner already ruled on in its latest run", () => {
    const rows = pendingLoopProposals([
      run("old", "2026-09-01T00:00:00Z", ["rec-1"]),
      run("new", "2026-09-05T00:00:00Z", ["rec-1"], { cover: "rec-1", verdict: "approved" }),
    ]);
    expect(rows).toEqual([]);
  });
});

describe("applyProposalFilters", () => {
  const rows: ProposalRow[] = mergeProposals([followUp()], pendingLoopProposals([run("r1", "2026-09-01T00:00:00Z", ["rec-1"])]));

  it("puts loop proposals first and keeps both sources in the working set", () => {
    expect(rows.map((r) => r.source)).toEqual(["loop", "scan"]);
    expect(applyProposalFilters(rows, emptyFilters(), new Set())).toHaveLength(2);
  });

  it("filters by source", () => {
    expect(applyProposalFilters(rows, emptyFilters(), new Set(["loop"])).map((r) => r.source)).toEqual(["loop"]);
  });

  it("excludes a loop proposal from an Impact filter and from the resolved archive — it has neither", () => {
    expect(applyProposalFilters(rows, { ...emptyFilters(), impacts: new Set(["high"]) }, new Set()).map((r) => r.source)).toEqual(["scan"]);
    expect(applyProposalFilters(rows, { ...emptyFilters(), statuses: new Set(["done", "dismissed"]) }, new Set())).toEqual([]);
  });

  it("matches repo and search across both sources", () => {
    expect(applyProposalFilters(rows, { ...emptyFilters(), repos: new Set(["acme/web"]) }, new Set()).map((r) => r.source)).toEqual(["loop"]);
    expect(applyProposalFilters(rows, { ...emptyFilters(), query: "codeowners" }, new Set()).map((r) => r.source)).toEqual(["scan"]);
  });
});
