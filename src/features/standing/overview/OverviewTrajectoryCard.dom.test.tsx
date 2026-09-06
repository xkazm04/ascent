// @vitest-environment jsdom
//
// The fleet trajectory card is gated on PRESENTABILITY, not on the fit existing. A rendered ETA on
// this card is the most quotable number on the org's front page — "on track to reach L4 in six
// weeks" is the sentence that gets repeated in a room — so the thing worth pinning is that a thin
// fit produces no card at all, rather than a confident straight line through two scan days.
//
// Rendered, not read from the source: the gate is a runtime predicate here (the component is a plain
// function, unlike PersonalOverview's async server component, which is why its sibling guard reads
// source instead).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { OverviewTrajectoryCard } from "@/features/standing/overview/OverviewTrajectoryCard";
import { forecastTrajectory, isProjectable, MIN_FORECAST_POINTS, MIN_FORECAST_SPAN_DAYS } from "@/lib/maturity/forecast";

/** A per-day trend series: `n` points, one every `stepDays`, climbing 2 points each. */
function series(n: number, stepDays: number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++)
    out.push({
      date: new Date(start + i * stepDays * 86_400_000).toISOString().slice(0, 10),
      value: 50 + i * 2,
    });
  return out;
}

describe("OverviewTrajectoryCard — the fleet's forward read, behind the shared gate", () => {
  it("renders the trajectory card for a presentable fit", () => {
    // Comfortably over both halves of the gate: enough distinct scan days AND enough calendar span.
    const forecast = forecastTrajectory(series(MIN_FORECAST_POINTS + 3, 10));
    expect(isProjectable(forecast)).toBe(true);

    render(<OverviewTrajectoryCard forecast={forecast} />);

    expect(screen.getByText("Trajectory")).toBeTruthy();
    // The card's substance, not just its heading: the horizon projection is what the Overview was
    // discarding when it dropped `rollup.forecast` on the floor.
    expect(screen.getByText(`In ${forecast!.horizonDays}d`)).toBeTruthy();
  });

  it("renders NOTHING when the fit has the points but not the calendar span", () => {
    // Three scans in three days is a blip, not a trend. The old personal-tier defect (MC-B34) was
    // projecting exactly this.
    const forecast = forecastTrajectory(series(MIN_FORECAST_POINTS, 1));
    expect(forecast).not.toBeNull();
    expect(forecast!.spanDays).toBeLessThan(MIN_FORECAST_SPAN_DAYS);
    expect(isProjectable(forecast)).toBe(false);

    const { container } = render(<OverviewTrajectoryCard forecast={forecast} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders NOTHING when the fit has the span but not the points", () => {
    const forecast = forecastTrajectory(series(MIN_FORECAST_POINTS - 1, 60));
    expect(isProjectable(forecast)).toBe(false);

    const { container } = render(<OverviewTrajectoryCard forecast={forecast} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders NOTHING when there is no fit at all", () => {
    // An org with a single scan day (or none): absence, not a refusal to explain.
    const { container } = render(<OverviewTrajectoryCard forecast={null} />);
    expect(container.innerHTML).toBe("");
  });
});
