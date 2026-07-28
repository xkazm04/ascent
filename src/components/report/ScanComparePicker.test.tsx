// @vitest-environment jsdom
//
// G5-26: nothing enforced or hinted that "Baseline (before)" should be chronologically OLDER than
// "Compared (after)". A user could invert the pair and get an all-red "What changed" panel that reads
// as a regression while actually looking backward in time. Pins the new inline hint.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanComparePicker } from "./ScanComparePicker";
import type { HistoryPoint } from "@/lib/db/scans";

vi.mock("next/navigation", () => ({
  usePathname: () => "/compare/acme/widget",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
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
