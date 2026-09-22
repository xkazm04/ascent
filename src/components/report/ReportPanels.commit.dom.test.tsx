// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PersistedRecommendation, ScanReport } from "@/lib/types";

vi.mock("./RoadmapSandbox", () => ({
  RoadmapSandbox: ({ recs, onRecommendationCommitted }: {
    recs: PersistedRecommendation[];
    onRecommendationCommitted: (rec: PersistedRecommendation) => void;
  }) => <button onClick={() => onRecommendationCommitted({ ...recs[0]!, status: "in_progress" })}>Commit</button>,
}));
vi.mock("./RecommendationTracker", () => ({
  RecommendationTracker: ({ items }: { items: PersistedRecommendation[] }) =>
    <div data-testid="tracker-status">{items[0]?.status}</div>,
}));
vi.mock("./roadmapPieces", () => ({
  TrustLadder: () => null,
  NextLevelPath: () => null,
  RoadmapSteps: () => null,
}));

import { ReportPanels, type ReportPanelsProps } from "./ReportPanels";

describe("sandbox commit to roadmap tracker", () => {
  it("shows a committed status after switching tabs without reloading", () => {
    const rec = { id: "rec-1", status: "open" } as PersistedRecommendation;
    const report = { level: { id: "L2" }, roadmap: [] } as unknown as ScanReport;
    const props = {
      tab: "sandbox", report, recs: [rec], isMock: false, showActivity: false,
      overallDelta: null, trendPoints: [], histError: false, scans: [],
      prevPosture: null, prevDimScores: null, dimSeries: null,
    } as ReportPanelsProps;
    const { rerender } = render(<ReportPanels {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    rerender(<ReportPanels {...props} tab="roadmap" />);
    expect(screen.getByTestId("tracker-status")).toHaveTextContent("in_progress");
  });
});
