import { describe, it, expect } from "vitest";
import { forecastTrajectory, forecastHeadline, humanizeDays, type SeriesPoint } from "./forecast";

const DAY = 86_400_000;

/** Build a daily series of `count` points starting at `start`, stepping `step`/day. */
function series(start: number, step: number, count: number, startDate = "2026-01-01"): SeriesPoint[] {
  const base = Date.parse(startDate);
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(base + i * DAY).toISOString().slice(0, 10),
    value: start + step * i,
  }));
}

describe("forecastTrajectory", () => {
  it("returns null without at least two distinct days", () => {
    expect(forecastTrajectory([])).toBeNull();
    expect(forecastTrajectory(series(50, 1, 1))).toBeNull();
    // Two readings, same day → no slope to fit.
    expect(
      forecastTrajectory([
        { date: "2026-01-01", value: 50 },
        { date: "2026-01-01", value: 60 },
      ]),
    ).toBeNull();
  });

  it("fits a rising trend and projects a promotion ETA", () => {
    const f = forecastTrajectory(series(50, 1, 11))!; // 50→60 over 10 days, +1/day
    expect(f).not.toBeNull();
    expect(f.trajectory).toBe("rising");
    expect(f.perWeek).toBe(7);
    expect(f.current).toBe(60);
    expect(f.currentLevel).toBe("L3");
    expect(f.fitQuality).toBe(1); // perfectly linear
    expect(f.eta).not.toBeNull();
    expect(f.eta!.kind).toBe("promotion");
    expect(f.eta!.fromLevel).toBe("L3");
    expect(f.eta!.toLevel).toBe("L4");
    expect(f.eta!.boundary).toBe(65);
    expect(f.eta!.days).toBe(5); // (65 − 60) / 1
    expect(f.eta!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fits a falling trend and projects a demotion ETA", () => {
    const f = forecastTrajectory(series(60, -1, 11))!; // 60→50 over 10 days, −1/day
    expect(f.trajectory).toBe("falling");
    expect(f.perWeek).toBe(-7);
    expect(f.current).toBe(50);
    expect(f.eta!.kind).toBe("demotion");
    expect(f.eta!.fromLevel).toBe("L3");
    expect(f.eta!.toLevel).toBe("L2");
    expect(f.eta!.boundary).toBe(44);
    expect(f.eta!.days).toBe(6); // (44 − 50) / −1
  });

  it("treats sub-threshold drift as flat with no ETA", () => {
    const flat = forecastTrajectory(series(50, 0, 11))!;
    expect(flat.trajectory).toBe("flat");
    expect(flat.eta).toBeNull();
    expect(flat.fitQuality).toBe(1); // a flat line fits a flat series exactly

    const noisy = forecastTrajectory(series(50, 0.05, 11))!; // 0.35/wk < 0.5/wk threshold
    expect(noisy.trajectory).toBe("flat");
    expect(noisy.eta).toBeNull();
  });

  it("projects the headline score out to the horizon and clamps to 0..100", () => {
    const f = forecastTrajectory(series(50, 1, 11), 90)!;
    expect(f.horizonDays).toBe(90);
    expect(f.projected).toBe(100); // 60 + 90 clamps at 100
    expect(f.projectedLevel).toBe("L5");
  });

  it("yields no ETA at the ceiling (rising in L5) or floor (falling in L1)", () => {
    const ceiling = forecastTrajectory(series(88, 1, 5))!; // 88→92, all L5
    expect(ceiling.trajectory).toBe("rising");
    expect(ceiling.currentLevel).toBe("L5");
    expect(ceiling.eta).toBeNull();

    const floor = forecastTrajectory(series(20, -1, 5))!; // 20→16, all L1
    expect(floor.trajectory).toBe("falling");
    expect(floor.currentLevel).toBe("L1");
    expect(floor.eta).toBeNull();
  });

  it("ignores unparseable dates and out-of-order input", () => {
    const f = forecastTrajectory([
      { date: "2026-01-11", value: 60 },
      { date: "not-a-date", value: 999 },
      { date: "2026-01-01", value: 50 },
    ])!;
    expect(f.points).toBe(2);
    expect(f.current).toBe(60); // latest by date, not by array position
    expect(f.trajectory).toBe("rising");
  });
});

describe("humanizeDays", () => {
  it("scales the unit with the horizon", () => {
    expect(humanizeDays(1)).toBe("~1 day");
    expect(humanizeDays(5)).toBe("~5 days");
    expect(humanizeDays(14)).toBe("~2 weeks");
    expect(humanizeDays(56)).toBe("~8 weeks");
    expect(humanizeDays(90)).toBe("~3 months");
  });
});

describe("forecastHeadline", () => {
  it("phrases promotion, demotion, and flat reads", () => {
    expect(forecastHeadline(forecastTrajectory(series(50, 1, 11))!)).toMatch(/On track to reach L4/);
    expect(forecastHeadline(forecastTrajectory(series(60, -1, 11))!)).toMatch(/At risk of slipping to L2/);
    expect(forecastHeadline(forecastTrajectory(series(50, 0, 11))!)).toMatch(/Holding around/);
  });
});
