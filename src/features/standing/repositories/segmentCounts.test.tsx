// @vitest-environment jsdom
//
// Chips, rollup cards, and compare tiles must label tagged vs scored, and a missing average must
// never print as 0 scored / 0/N scanned.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/org/acme/repositories",
  useSearchParams: () => new URLSearchParams("tab=segments"),
}));

import { compareCountSub, taggedScoredLabel } from "./segmentCounts";
import { SegmentChips } from "./RepoSegmentsPanel.parts";
import { SegmentCard } from "./SegmentCard";
import { SegmentsComparePanel } from "./SegmentsComparePanel";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";

const summary = (over: Partial<SegmentSummary> & { name: string }): SegmentSummary =>
  ({
    id: over.name,
    name: over.name,
    repoCount: 3,
    scannedCount: 2,
    avgOverall: 60,
    avgAdoption: 55,
    avgRigor: 65,
    posture: "balanced",
    dimAverages: [],
    ...over,
  }) as SegmentSummary;

const unscanned = (name: string): SegmentSummary =>
  summary({ name, scannedCount: 0, avgOverall: null, avgAdoption: null, avgRigor: null, posture: null });

describe("taggedScoredLabel", () => {
  it("labels tagged alone when there is no score, never 0 scored", () => {
    expect(taggedScoredLabel(5, null)).toBe("5 tagged");
    expect(taggedScoredLabel(0, null)).toBe("0 tagged");
    expect(taggedScoredLabel(5, null)).not.toMatch(/scored/);
  });

  it("labels both counts when a score exists, including a measured zero", () => {
    expect(taggedScoredLabel(5, 2)).toBe("5 tagged · 2 scored");
    expect(taggedScoredLabel(3, 3)).toBe("3 tagged · 3 scored");
  });
});

describe("compareCountSub", () => {
  it("does not coalesce a missing score to 0/N scanned", () => {
    expect(compareCountSub({ score: null, scannedCount: 0, tagged: 4, postureLine: "Not classified" })).toBe(
      "no scans yet · 4 tagged",
    );
    expect(compareCountSub({ score: null, scannedCount: 0, tagged: 4, postureLine: "x" })).not.toMatch(/0\//);
    expect(compareCountSub({ score: null, scannedCount: 0, tagged: 4, postureLine: "x" })).not.toMatch(/0 scored/);
  });

  it("names tagged vs scored on a measured side", () => {
    expect(compareCountSub({ score: 60, scannedCount: 2, tagged: 5, postureLine: "Balanced" })).toBe(
      "Balanced · 5 tagged · 2 scored",
    );
  });
});

describe("chips, cards, and compare tiles", () => {
  it("labels the chip count as tagged", () => {
    render(
      <SegmentChips
        segments={[{ id: "s1", name: "platform", color: "#3b9eff", repoCount: 5 }]}
        startEdit={() => {}}
        onDeleteRequest={() => {}}
      />,
    );
    const chip = screen.getByLabelText("Edit platform segment").closest("span")!;
    expect(within(chip).getByText("5 tagged")).toBeInTheDocument();
    expect(within(chip).queryByText("5")).toBeNull();
  });

  it("labels the card tagged vs scored and omits 0 scored when there is no average", () => {
    render(<SegmentCard s={unscanned("new")} org="acme" repos={[]} taggedCount={4} />);
    expect(screen.getByText("4 tagged")).toBeInTheDocument();
    expect(screen.queryByText(/0 scored/)).toBeNull();
    expect(screen.queryByText(/0\/4/)).toBeNull();
  });

  it("shows both counts on a scored card", () => {
    render(<SegmentCard s={summary({ name: "platform", id: "platform" })} org="acme" repos={["a/x"]} taggedCount={5} />);
    expect(screen.getByText("5 tagged · 2 scored")).toBeInTheDocument();
  });

  it("compare tiles distinguish tagged vs scored and never print 0/ for a missing side", () => {
    const comparison: SegmentComparison = {
      a: summary({ name: "platform", id: "platform" }),
      b: unscanned("new"),
      deltas: { overall: null, adoption: null, rigor: null },
      dimDeltas: [],
    };
    render(
      <SegmentsComparePanel
        options={[{ id: "platform", name: "platform" }, { id: "new", name: "new" }]}
        aId="platform"
        bId="new"
        comparison={comparison}
        taggedById={{ platform: 5, new: 4 }}
      />,
    );
    expect(screen.getByText(/5 tagged · 2 scored/)).toBeInTheDocument();
    expect(screen.getByText(/no scans yet · 4 tagged/)).toBeInTheDocument();
    expect(screen.queryByText(/0\//)).toBeNull();
    expect(screen.queryByText(/0 scored/)).toBeNull();
  });
});
