// @vitest-environment jsdom
//
// D9: the two things the persisted tracker had on the wire and never rendered.
//
// 1. `firstStep` — selected, typed and shipped to every persistence-enabled org, but rendered ONLY by
//    RoadmapSteps, the anonymous/no-DB fallback. Turning tracking on made the roadmap strictly poorer.
// 2. The measured basis — `ExpectedLiftBasis` was mounted here, but no caller ever passed `lifts`, so
//    the clause (and the measured sort toggle it gates) could not appear in-app at all.
//
// Both must degrade to ABSENCE, never to a placeholder or a "+0" (G4).

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PersistedRecommendation, ScanReport } from "@/lib/types";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import { roadmapLiftKey } from "@/components/report/roadmapPriority";

vi.mock("@/components/report/OrphanedTracking", () => ({ OrphanedTracking: () => null }));

// PARTIAL: the engine-backed chips are stubbed (they need a full scored report) so these assertions
// stay on the row's own text. RoadmapFirstStep — the subject of half this file — stays real.
vi.mock("@/components/report/roadmapPieces", async (orig) => ({
  ...(await orig<typeof import("@/components/report/roadmapPieces")>()),
  RoadmapMeta: () => null,
  PayoffChip: () => null,
  ExploreList: () => null,
  ExemplarPointer: () => null,
}));

import { RecommendationTracker } from "./RecommendationTracker";

const report = {
  repo: { owner: "acme", name: "web" },
  dimensions: [{ id: "D2", score: 60 }],
} as unknown as ScanReport;

function item(over: Partial<PersistedRecommendation> = {}): PersistedRecommendation {
  return {
    id: "r1",
    title: "Adopt review checklist",
    dimension: "D2" as PersistedRecommendation["dimension"],
    impact: "high" as PersistedRecommendation["impact"],
    effort: "low" as PersistedRecommendation["effort"],
    rationale: "",
    explore: [],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...over,
  };
}

function dist(identityKey: string, medianDim: number): LiftDistribution {
  return {
    identityKey,
    dimId: "D2",
    n: 9,
    orgs: 1,
    medianDim,
    p25: medianDim - 4,
    p75: medianDim + 4,
    medianOverall: 3,
    instrument: { rubricVersion: "r10", engineProvider: "claude" },
  };
}

describe("RecommendationTracker — the first step reaches the tracked surface", () => {
  it("renders the recorded first step, labelled as RoadmapSteps labels it", () => {
    render(<RecommendationTracker items={[item({ firstStep: "Open a PR adding CODEOWNERS." })]} report={report} />);
    expect(screen.getByText("First step:")).toBeInTheDocument();
    expect(screen.getByText(/Open a PR adding CODEOWNERS\./)).toBeInTheDocument();
  });

  it("renders NOTHING when the scan recorded no first step — no placeholder line", () => {
    render(<RecommendationTracker items={[item()]} report={report} />);
    expect(screen.queryByText("First step:")).not.toBeInTheDocument();
  });

  it("treats a blank first step as absent", () => {
    render(<RecommendationTracker items={[item({ firstStep: "   " })]} report={report} />);
    expect(screen.queryByText("First step:")).not.toBeInTheDocument();
  });
});

const measured = item();
const lifts = new Map([[roadmapLiftKey(measured), dist(roadmapLiftKey(measured), 11)]]);

describe("RecommendationTracker — the measured basis, from the lift map", () => {
  it("renders the clause with its median, sample count and instrument when a pair exists", () => {
    render(<RecommendationTracker items={[measured]} report={report} lifts={lifts} />);
    const clause = screen.getByText(/median/);
    expect(clause.textContent).toContain("+11 median");
    expect(clause.textContent).toContain("9 measured closes");
    expect(clause.textContent).toContain("r10");
  });

  it("offers the measured sort toggle only once something is measured", () => {
    const { unmount } = render(<RecommendationTracker items={[measured]} report={report} lifts={lifts} />);
    expect(screen.getByRole("button", { name: "measured" })).toBeInTheDocument();
    unmount();
    // No map ⇒ no toggle: an ordering offered over an empty ledger advertises evidence that isn't there.
    render(<RecommendationTracker items={[measured]} report={report} />);
    expect(screen.queryByRole("button", { name: "measured" })).not.toBeInTheDocument();
  });

  it("renders no basis at all for an item the ledger has nothing on", () => {
    render(<RecommendationTracker items={[item({ id: "r9", title: "Something else" })]} report={report} lifts={lifts} />);
    expect(screen.queryByText(/median/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+0/)).not.toBeInTheDocument();
  });
});

describe("RecommendationTracker — the wire clause on the client-fetch path", () => {
  // The live-scan path has no server-rendered map; ReportView fetches rows from GET
  // /api/recommendations, which computes the same clause per item as `expectedLift`.
  it("renders the row's own expectedLift clause when no map was supplied", () => {
    render(
      <RecommendationTracker
        items={[item({ expectedLift: "D2 +11 median across 9 measured closes · r10 · claude" })]}
        report={report}
      />,
    );
    expect(screen.getByText(/\+11 median across 9 measured closes/)).toBeInTheDocument();
  });

  it("ignores the wire clause when a map is present — one answer per row, never two", () => {
    render(
      <RecommendationTracker
        items={[item({ expectedLift: "D2 +99 median across 4 measured closes · r9 · mock" })]}
        report={report}
        lifts={lifts}
      />,
    );
    expect(screen.queryByText(/\+99 median/)).not.toBeInTheDocument();
    expect(screen.getByText(/\+11 median/)).toBeInTheDocument();
  });

  it("renders nothing when the wire says null", () => {
    render(<RecommendationTracker items={[item({ expectedLift: null })]} report={report} />);
    expect(screen.queryByText(/median/)).not.toBeInTheDocument();
  });
});
