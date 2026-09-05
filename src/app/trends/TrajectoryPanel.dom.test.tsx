// @vitest-environment jsdom
// Pins the honesty layer around the trends forecast (G5-01 / G4-16):
//   • the panel is LABELLED as an all-time trajectory and states the fit basis, so it can never read
//     as a projection of the range-toggled chart below it;
//   • a sample too thin to project renders the refusal, and NO ETA.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrajectoryPanel } from "@/app/trends/TrajectoryPanel";
import { fitTrendForecast } from "@/app/trends/forecast";
import type { HistoryPoint } from "@/lib/db/scans";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-19T12:00:00.000Z");

function pt(daysAgo: number, overallScore: number): HistoryPoint {
  return {
    id: `s${daysAgo}`,
    headSha: null,
    overallScore,
    level: "L3",
    levelName: "Integrating",
    confidence: 0.9,
    engineProvider: "test",
    engineModel: "test",
    scannedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    dimensions: [],
  };
}

describe("TrajectoryPanel", () => {
  it("labels the forecast as all-time and says it does not follow the range toggle", () => {
    const scans = [pt(0, 62), pt(20, 56), pt(40, 52), pt(60, 48)];
    const forecast = fitTrendForecast(scans, NOW);
    render(<TrajectoryPanel forecast={forecast} scanCount={scans.length} />);

    expect(screen.getByRole("heading", { name: /all-time trajectory/i })).toBeTruthy();
    const basis = screen.getByText(/does not follow the 5d \/ 30d \/ 90d range toggle/i);
    expect(basis.textContent).toContain("all 4 scans");
    expect(basis.textContent).toContain("4 distinct scan days");
  });

  it("refuses to project a dense-but-short sample, and shows no ETA", () => {
    const scans = [pt(0, 61), pt(1, 55), pt(2, 60), pt(3, 52)]; // 4 days of span
    render(<TrajectoryPanel forecast={fitTrendForecast(scans, NOW)} scanCount={scans.length} />);

    expect(screen.getByText(/not enough history to project/i)).toBeTruthy();
    expect(screen.queryByText(/ETA/)).toBeNull();
    expect(screen.queryByText(/trend confidence/i)).toBeNull();
  });

  it("refuses when there is no fit at all", () => {
    render(<TrajectoryPanel forecast={null} scanCount={1} />);
    expect(screen.getByText(/not enough history to project/i)).toBeTruthy();
  });
});
