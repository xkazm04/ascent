// @vitest-environment jsdom
//
// G5-26: nothing enforced or hinted that "Baseline (before)" should be chronologically OLDER than
// "Compared (after)". A user could invert the pair and get an all-red "What changed" panel that reads
// as a regression while actually looking backward in time. Pins the new inline hint.

import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScanComparePicker } from "./ScanComparePicker";
import type { HistoryPoint } from "@/lib/db/scans";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/compare/acme/widget",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

function scan(id: string, scannedAt: string, overallScore = 50): HistoryPoint {
  return {
    id,
    headSha: null,
    overallScore,
    level: "L3",
    levelName: "Established",
    confidence: 80,
    engineProvider: "claude-cli",
    engineModel: "sonnet",
    scannedAt,
    dimensions: [],
  };
}

// Newest-first, matching the documented HistoryPoint contract.
const scans: HistoryPoint[] = [
  scan("newer", "2026-07-20T00:00:00.000Z", 70),
  scan("older", "2026-07-01T00:00:00.000Z", 50),
];

describe("ScanComparePicker — chronological-order hint", () => {
  it("shows a warning when the baseline (before) is NEWER than the compared (after) scan", () => {
    render(<ScanComparePicker repo="acme/widget" scans={scans} beforeId="newer" afterId="older" />);

    expect(screen.getByText(/baseline is newer than the compared scan/i)).toBeInTheDocument();
  });

  it("shows no warning when the baseline is OLDER than the compared scan (correct order)", () => {
    render(<ScanComparePicker repo="acme/widget" scans={scans} beforeId="older" afterId="newer" />);

    expect(screen.queryByText(/baseline is newer than the compared scan/i)).toBeNull();
  });

  it("shows no warning when both scans share the same timestamp (no ordering to violate)", () => {
    const same: HistoryPoint[] = [scan("a", "2026-07-10T00:00:00.000Z"), scan("b", "2026-07-10T00:00:00.000Z")];
    render(<ScanComparePicker repo="acme/widget" scans={same} beforeId="a" afterId="b" />);

    expect(screen.queryByText(/baseline is newer than the compared scan/i)).toBeNull();
  });
});

// ── The Against (exemplar) field — moonshot #34 ─────────────────────────────────────────────────

const exemplarOptions = [
  { value: "repo:acme/api", label: "acme/api", group: "Your repos" as const, scannedAt: null },
  { value: "org:best", label: "best in org overall", group: "Org best" as const, scannedAt: null },
  { value: "cohort:lang:TypeScript", label: "TypeScript · top decile", group: "Cohort" as const, scannedAt: null },
];

describe("ScanComparePicker — Against (exemplar) field", () => {
  beforeEach(() => push.mockClear());

  it("is absent when no exemplar is offerable — an empty dropdown would promise a comparison that can't be made", () => {
    render(<ScanComparePicker repo="acme/widget" scans={scans} beforeId="older" afterId="newer" />);
    expect(screen.queryByLabelText(/exemplar to compare against/i)).toBeNull();
  });

  it("renders one optgroup per populated group", () => {
    render(
      <ScanComparePicker repo="acme/widget" scans={scans} beforeId="older" afterId="newer" exemplarOptions={exemplarOptions} />,
    );
    const select = screen.getByLabelText(/exemplar to compare against/i);
    expect(select).toBeInTheDocument();
    for (const g of ["Your repos", "Org best", "Cohort"]) {
      expect(select.querySelector(`optgroup[label="${g}"]`)).not.toBeNull();
    }
  });

  it("pushes against= while keeping the scan pair, so the exemplar comparison is shareable", () => {
    render(
      <ScanComparePicker repo="acme/widget" scans={scans} beforeId="older" afterId="newer" exemplarOptions={exemplarOptions} />,
    );
    fireEvent.change(screen.getByLabelText(/exemplar to compare against/i), { target: { value: "org:best" } });
    expect(push).toHaveBeenCalledWith("/compare/acme/widget?repo=acme%2Fwidget&a=newer&b=older&against=org%3Abest");
  });

  it("'None' removes against= and leaves a and b intact", () => {
    render(
      <ScanComparePicker
        repo="acme/widget"
        scans={scans}
        beforeId="older"
        afterId="newer"
        exemplarOptions={exemplarOptions}
        against="org:best"
      />,
    );
    fireEvent.change(screen.getByLabelText(/exemplar to compare against/i), { target: { value: "" } });
    expect(push).toHaveBeenCalledWith("/compare/acme/widget?repo=acme%2Fwidget&a=newer&b=older");
  });

  it("carries the chosen exemplar through a baseline change rather than dropping it", () => {
    render(
      <ScanComparePicker
        repo="acme/widget"
        scans={scans}
        beforeId="older"
        afterId="newer"
        exemplarOptions={exemplarOptions}
        against="cohort:lang:TypeScript"
      />,
    );
    fireEvent.change(screen.getByLabelText("Baseline scan"), { target: { value: "newer" } });
    expect(push).toHaveBeenCalledWith(
      "/compare/acme/widget?repo=acme%2Fwidget&a=newer&b=newer&against=cohort%3Alang%3ATypeScript",
    );
  });

  // UAT `SAM-L1-13`: the exemplar axis needs no second scan, but the whole compare surface was gated
  // on the pair, so the repo with the most to gain from a peer comparison could not reach one.
  it("keeps the exemplar field on a repo with ONE scan, and drops the time controls", () => {
    render(
      <ScanComparePicker
        repo="acme/widget"
        scans={[scan("only", "2026-07-20T00:00:00.000Z", 70)]}
        beforeId="only"
        afterId="only"
        exemplarOptions={exemplarOptions}
      />,
    );
    expect(screen.getByLabelText(/exemplar to compare against/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Baseline scan")).toBeNull();
    expect(screen.queryByLabelText("Compared scan")).toBeNull();
  });

  it("names the PUBLIC-corpus groups for a viewer the org gate resolved to the public namespace", () => {
    render(
      <ScanComparePicker
        repo="pub/widget"
        scans={scans}
        beforeId="older"
        afterId="newer"
        exemplarOptions={[
          { value: "repo:pub/api", label: "pub/api", group: "Public corpus" as const, scannedAt: null },
          { value: "org:best", label: "best in the public corpus", group: "Corpus best" as const, scannedAt: null },
        ]}
      />,
    );
    const select = screen.getByLabelText(/exemplar to compare against/i);
    for (const g of ["Public corpus", "Corpus best"]) {
      expect(select.querySelector(`optgroup[label="${g}"]`)).not.toBeNull();
    }
    expect(select.querySelector('optgroup[label="Your repos"]')).toBeNull();
  });
});
