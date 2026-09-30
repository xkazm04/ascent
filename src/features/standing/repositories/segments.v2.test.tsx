// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";
import { SegmentMaturityV2 } from "./SegmentMaturity.v2";
import { SegmentsCompareV2 } from "./SegmentsCompare.v2";
import { SegmentComparePickerV2 } from "./SegmentComparePicker.v2";
import { RepoSegmentsPanelV2 } from "./RepoSegmentsPanel.v2";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/org/acme",
  useSearchParams: () => new URLSearchParams("tab=segments"),
}));

const scored = {
  id: "platform",
  name: "platform",
  repoCount: 3,
  scannedCount: 2,
  avgOverall: 60,
  avgAdoption: 55,
  avgRigor: 65,
  posture: "balanced",
  dimAverages: [],
} as SegmentSummary;

const unscanned = {
  ...scored,
  id: "new",
  name: "new",
  scannedCount: 0,
  avgOverall: null,
  avgAdoption: null,
  avgRigor: null,
  posture: null,
} as SegmentSummary;

describe("segment prism pieces", () => {
  it("prints a paper score and leaves an unscanned slice unmeasured", () => {
    render(
      <SegmentMaturityV2
        slug="acme"
        summaries={[scored, unscanned]}
        reposBySegment={{ platform: ["a/x", "a/y"], new: ["a/z"] }}
        watched={new Set(["a/x"])}
      />,
    );
    expect(screen.getAllByText("60").length).toBeGreaterThan(0);
    expect(screen.getByText("2 tagged · 2 scored")).toBeInTheDocument();
    expect(screen.getByText("1 tagged")).toBeInTheDocument();
    expect(screen.queryByText("0 scored")).toBeNull();
    expect(screen.getAllByText("not measured").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Scan segment (1 of 2 watched)" })).toBeInTheDocument();
  });

  it("withholds a difference when one side has no scans", () => {
    const comparison = {
      a: scored,
      b: unscanned,
      deltas: { overall: null, adoption: null, rigor: null },
      dimDeltas: [{ dimId: "D1", a: 80, b: null, delta: null }],
    } as SegmentComparison;
    render(
      <SegmentsCompareV2
        options={[{ id: "platform", name: "platform" }, { id: "new", name: "new" }]}
        aId="platform"
        bId="new"
        comparison={comparison}
        taggedById={{ platform: 5, new: 1 }}
      />,
    );
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getAllByText("not measured").length).toBeGreaterThan(0);
    expect(screen.getByText("Difference not measured")).toBeInTheDocument();
    expect(screen.getByText(/has no scanned repos yet/)).toBeInTheDocument();
  });

  it("writes the comparison into the query", () => {
    render(
      <SegmentComparePickerV2
        options={[{ id: "platform", name: "platform" }, { id: "legacy", name: "legacy" }]}
        a="platform"
        b={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Segment B"), { target: { value: "legacy" } });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("a=platform"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("b=legacy"));
  });

  it("offers the create field when the org has no segments yet", () => {
    render(<RepoSegmentsPanelV2 slug="acme" repos={[{ fullName: "acme/api", name: "api" }]} segments={[]} membership={{}} />);
    expect(screen.getByText("No segments yet. Create one to start tagging.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("New segment name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add segment" })).toBeDisabled();
  });
});
