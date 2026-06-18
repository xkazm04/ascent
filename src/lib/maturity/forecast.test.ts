import { describe, it, expect } from "vitest";
import {
  forecastTrajectory,
  forecastHeadline,
  humanizeDays,
  projectGoal,
  type SeriesPoint,
} from "./forecast";

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

describe("projectGoal", () => {
  // A fixed "present" so the verdict ladder and ETA dates are deterministic.
  const NOW = "2026-02-01";
  const nowMs = Date.parse(NOW);

  // A perfectly linear rising trend: 50→60 over 10 days, +1/day. forecastTrajectory anchors
  // `current` at the latest value (60) and reads perDay=1 / perWeek=7 exactly.
  const rising = series(50, 1, 11); // latest value 60, slope +1/day

  it("reports 'reached' (and no ETA) once current meets/exceeds target", () => {
    // current == target boundary.
    const at = projectGoal({ series: rising, current: 80, target: 80, targetDate: "2026-03-01", nowMs });
    expect(at.pace).toBe("reached");
    expect(at.etaDays).toBeNull();
    expect(at.etaDate).toBeNull();
    // No negative ETA, and no required-rate fire drill once the target is in hand.
    expect(at.requiredPerWeek).toBeNull();

    // current strictly above target → still reached.
    const over = projectGoal({ series: rising, current: 90, target: 80, targetDate: null, nowMs });
    expect(over.pace).toBe("reached");
    expect(over.etaDays).toBeNull();
  });

  it("is 'on-pace' when the projected crossing lands on/before the deadline (etaDate <= targetDate)", () => {
    // perDay=1, target 80, current 60 → ETA = 20 days → 2026-02-21.
    const targetDate = "2026-03-01"; // 28 days out, after the 2026-02-21 crossing.
    const p = projectGoal({ series: rising, current: 60, target: 80, targetDate, nowMs });
    expect(p.pace).toBe("on-pace");
    expect(p.etaDays).toBe(20);
    expect(p.etaDate).toBe("2026-02-21");
    expect(Date.parse(p.etaDate!)).toBeLessThanOrEqual(Date.parse(targetDate));
    // The rate it's actually moving at.
    expect(p.perWeek).toBe(7);
    expect(p.daysToDeadline).toBe(28);
  });

  it("pins the boundary of the on-pace/behind threshold: etaDate exactly == deadline is still on-pace", () => {
    // ETA lands on 2026-02-21; set the deadline to that same day → the `<=` keeps it on-pace.
    const onBoundary = projectGoal({ series: rising, current: 60, target: 80, targetDate: "2026-02-21", nowMs });
    expect(onBoundary.etaDate).toBe("2026-02-21");
    expect(onBoundary.pace).toBe("on-pace");

    // One day earlier than the crossing → tips to behind (the other side of the `<=`).
    const justBehind = projectGoal({ series: rising, current: 60, target: 80, targetDate: "2026-02-20", nowMs });
    expect(justBehind.pace).toBe("behind");
  });

  it("is 'behind' when the deadline is before the projected crossing, with requiredPerWeek > the current rate", () => {
    // Deadline 2026-02-10 (9 days out) is well before the 2026-02-21 crossing.
    const p = projectGoal({ series: rising, current: 60, target: 80, targetDate: "2026-02-10", nowMs });
    expect(p.pace).toBe("behind");
    // ETA still reported (it just lands too late).
    expect(p.etaDays).toBe(20);
    // Required weekly gain to make the deadline: (80−60)/9 days × 7 = 15.56 → 15.6.
    expect(p.requiredPerWeek).toBe(15.6);
    expect(p.requiredPerWeek!).toBeGreaterThan(p.perWeek); // must climb faster than it is.
    expect(p.daysToDeadline).toBe(9);
  });

  it("is the neutral 'tracking' with no deadline (ETA still shown when one exists)", () => {
    const p = projectGoal({ series: rising, current: 60, target: 80, targetDate: null, nowMs });
    expect(p.pace).toBe("tracking");
    expect(p.daysToDeadline).toBeNull();
    expect(p.requiredPerWeek).toBeNull();
    // The crossing ETA is independent of any deadline.
    expect(p.etaDays).toBe(20);
    expect(p.etaDate).toBe("2026-02-21");
  });

  it("is 'tracking' when there's no fittable trend yet, even with a deadline", () => {
    // A single point → forecastTrajectory returns null (fit is null) → tracking, not behind.
    const p = projectGoal({
      series: [{ date: "2026-01-01", value: 60 }],
      current: 60,
      target: 80,
      targetDate: "2026-03-01",
      nowMs,
    });
    expect(p.pace).toBe("tracking");
    expect(p.perWeek).toBe(0);
    expect(p.trajectory).toBe("flat");
    expect(p.fitQuality).toBe(0);
    expect(p.etaDays).toBeNull(); // no slope → no crossing.
  });

  it("a flat/zero-progress trend below target is 'behind' with no finite/negative ETA (no false on-pace)", () => {
    // Flat series → perDay 0 → no crossing → cannot be on-pace against a deadline.
    const flat = series(50, 0, 11); // perDay 0, fit is non-null (a flat line fits exactly).
    const p = projectGoal({ series: flat, current: 50, target: 80, targetDate: "2026-03-01", nowMs });
    expect(p.pace).toBe("behind"); // NOT a false "on pace".
    expect(p.etaDays).toBeNull(); // never projects a >1095-day / infinite ETA.
    expect(p.etaDate).toBeNull();
    // The deadline is real, so a required rate is still surfaced.
    expect(p.requiredPerWeek).not.toBeNull();
    expect(p.requiredPerWeek!).toBeGreaterThan(0);
  });

  it("a falling trend below target is 'behind' (it never reaches the target at this pace)", () => {
    const falling = series(60, -1, 11); // latest 50, slope −1/day, away from an 80 target.
    const p = projectGoal({ series: falling, current: 50, target: 80, targetDate: "2026-03-01", nowMs });
    expect(p.pace).toBe("behind");
    expect(p.etaDays).toBeNull();
    expect(p.trajectory).toBe("falling");
  });

  it("emits no requiredPerWeek once the deadline is past (daysLeft <= 0)", () => {
    // Deadline already gone by `nowMs` → no meaningful rate, but daysToDeadline goes negative.
    const p = projectGoal({ series: rising, current: 60, target: 80, targetDate: "2026-01-15", nowMs });
    expect(p.requiredPerWeek).toBeNull();
    expect(p.daysToDeadline).toBe(-17);
    expect(p.pace).toBe("behind"); // past deadline, target unreached.
  });

  it("caps a glacial ETA: a crawl that needs > 1095 days to reach the target yields no ETA → behind", () => {
    // 0.01/day toward a 30-point gap ⇒ 3000 days ⇒ over GOAL_ETA_CAP_DAYS (1095).
    const crawl = series(50, 0.01, 11); // perDay 0.01.
    const p = projectGoal({ series: crawl, current: 50, target: 80, targetDate: "2026-03-01", nowMs });
    expect(p.etaDays).toBeNull(); // capped, not a 9-year "on-pace" ETA.
    expect(p.pace).toBe("behind");
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
