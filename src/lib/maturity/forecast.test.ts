import { describe, it, expect } from "vitest";
import {
  MIN_FORECAST_SPAN_DAYS,
  composeTrajectory,
  forecastBasis,
  forecastInsufficiency,
  forecastTrajectory,
  forecastHeadline,
  humanizeDays,
  isProjectable,
  projectGoal,
  trajectoryLine,
  trajectoryNote,
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

/** The last observation's timestamp — the ETA anchor that reproduces the "days from last scan" math
 *  (used as an explicit `nowMs` so tests don't depend on the wall clock now that it defaults to it). */
const atLast = (s: SeriesPoint[]) => Date.parse(s[s.length - 1]!.date);

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
    const s = series(50, 1, 11); // 50→60 over 10 days, +1/day
    const f = forecastTrajectory(s, 90, atLast(s))!; // anchor NOW on the last obs → days-from-last math
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
    expect(f.lowData).toBe(false); // 11 distinct days → trustworthy fit
  });

  it("flags a < 3-distinct-day fit as low data (forecast-overconfidence #1)", () => {
    // Two distinct days: OLS fits a perfect line by construction (R²=1), so fitQuality reads 1.0 —
    // but with no degrees of freedom that "100% confidence" is meaningless. lowData must catch it so
    // the UI doesn't render a 2-point blip as a rock-solid trajectory.
    const f = forecastTrajectory([
      { date: "2026-01-01", value: 50 },
      { date: "2026-01-08", value: 60 },
    ])!;
    expect(f.points).toBe(2);
    expect(f.fitQuality).toBe(1); // perfect by construction, NOT by trend
    expect(f.lowData).toBe(true);

    // Three distinct days clear the low-data bar.
    const f3 = forecastTrajectory(series(50, 1, 3))!;
    expect(f3.points).toBe(3);
    expect(f3.lowData).toBe(false);
  });

  it("fits a falling trend and projects a demotion ETA", () => {
    const s = series(60, -1, 11); // 60→50 over 10 days, −1/day
    const f = forecastTrajectory(s, 90, atLast(s))!;
    expect(f.trajectory).toBe("falling");
    expect(f.perWeek).toBe(-7);
    expect(f.current).toBe(50);
    expect(f.eta!.kind).toBe("demotion");
    expect(f.eta!.fromLevel).toBe("L3");
    expect(f.eta!.toLevel).toBe("L2");
    expect(f.eta!.boundary).toBe(44);
    expect(f.eta!.days).toBe(6); // (44 − 50) / −1
  });

  it("anchors the ETA on nowMs, not the last scan — a stale gap never prints a past crossing (#4)", () => {
    const s = series(50, 1, 11); // last obs 2026-01-11 at 60, +1/day; ray crosses 65 at last+5 = 2026-01-16
    const lastMs = atLast(s);

    // Fresh scan (now == last obs): 5 days out, dated forward from now — the baseline.
    const fresh = forecastTrajectory(s, 90, lastMs)!;
    expect(fresh.eta!.days).toBe(5);
    expect(fresh.eta!.date).toBe("2026-01-16");

    // Stale by 30 days: the ray's crossing (2026-01-16) is already ~25 days behind the present, so the
    // OLD code printed "in ~5 days (≈ 2026-01-16)" — a past date. Now it's suppressed as already-reached.
    const stale = forecastTrajectory(s, 90, lastMs + 30 * DAY)!;
    expect(stale.eta).toBeNull();
    expect(forecastHeadline(stale)).not.toMatch(/2026-01-16/);

    // Stale but the crossing still lies ahead (crossing at last+40; now is last+10): the ETA is measured
    // from NOW (30 days) and dated forward from now, never a date in the past.
    const slow = series(50, 0.5, 21); // 50→60 over 20 days, +0.5/day; crosses 65 at last+10 → last+...
    const slowLast = atLast(slow); // 2026-01-21, value 60
    const ahead = forecastTrajectory(slow, 90, slowLast + 5 * DAY)!; // 5 days after the last scan
    expect(ahead.eta).not.toBeNull();
    expect(ahead.eta!.days).toBe(5); // (65−60)/0.5 = 10 from last, minus 5 stale = 5 from now
    expect(Date.parse(ahead.eta!.date)).toBeGreaterThan(slowLast); // dated forward from now, not the past
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
    const rise = series(50, 1, 11);
    const fall = series(60, -1, 11);
    expect(forecastHeadline(forecastTrajectory(rise, 90, atLast(rise))!)).toMatch(/On track to reach L4/);
    expect(forecastHeadline(forecastTrajectory(fall, 90, atLast(fall))!)).toMatch(/At risk of slipping to L2/);
    expect(forecastHeadline(forecastTrajectory(series(50, 0, 11))!)).toMatch(/Holding around/);
  });
});

// ── MOONSHOT #32 — compacted observations and the basis line ──────────────────────────────────────
// A compacted point is a period average of scans retention deleted. It is a legitimate observation of
// where the repo was, so it fits like any other — but the fit has to be able to SAY that it did, and
// the sample floors must not be softened by it (a summarised day is still one day).

describe("forecastTrajectory — compactedPoints", () => {
  it("is 0 for an all-scan series", () => {
    expect(forecastTrajectory(series(50, 1, 5))!.compactedPoints).toBe(0);
  });

  it("counts DAY-KEYS that carried at least one compacted observation, not observations", () => {
    const pts = series(50, 1, 5).map((p, i) => (i < 2 ? { ...p, compacted: true } : p));
    // Two same-day compacted readings must still count as ONE compacted day.
    pts.push({ ...pts[0]!, value: 51, compacted: true });
    const f = forecastTrajectory(pts)!;
    expect(f.points).toBe(5);
    expect(f.compactedPoints).toBe(2);
  });

  it("does not soften the sample floors: a compacted day is one day, no more", () => {
    const two = forecastTrajectory(series(50, 1, 2).map((p) => ({ ...p, compacted: true })))!;
    expect(two.points).toBe(2);
    expect(two.lowData).toBe(true); // MIN_FORECAST_POINTS is untouched by compaction
    expect(isProjectable(two)).toBe(false);
    // …and the slope itself is the same one the identical non-compacted series produces.
    expect(two.perDay).toBe(forecastTrajectory(series(50, 1, 2))!.perDay);
  });
});

describe("forecastBasis", () => {
  it("states days and span, and omits the compaction clause when there is none", () => {
    const f = forecastTrajectory(series(50, 1, 5))!;
    expect(forecastBasis(f)).toBe("fit over 5 scan days across 4 days");
  });

  it("names the compacted share when the fit rests on one", () => {
    const f = forecastTrajectory(series(50, 1, 5).map((p, i) => (i < 3 ? { ...p, compacted: true } : p)))!;
    expect(forecastBasis(f)).toBe("fit over 5 scan days across 4 days, 3 of them compacted");
  });

  it("singularises a one-day fit", () => {
    const f = forecastTrajectory([
      { date: "2026-01-01T01:00:00Z", value: 50 },
      { date: "2026-01-02T01:00:00Z", value: 51 },
    ])!;
    expect(forecastBasis(f)).toBe("fit over 2 scan days across 1 day");
  });
});

// MC-B1 / DANA-L1-001 (recurrence 3) — the composed read is the ONLY thing a presenting surface may
// print. These pin the contract's shape: a bare slope must be unreachable through it.
describe("composeTrajectory — the hedge is replaced, never deleted", () => {
  it("refuses to headline a lowData fit, and hands back Delivery's own refusal instead", () => {
    // The live arm-B capture: two scan days a day apart produced "Climbing at +35/wk" with no hedge.
    const f = forecastTrajectory([
      { date: "2026-08-21", value: 60 },
      { date: "2026-08-22", value: 65 },
    ]);
    const t = composeTrajectory(f);
    expect(t.headline).toBeNull();
    expect(t.confidence).toBeNull();
    expect(t.insufficiency).toBe(forecastInsufficiency(f));
    expect(t.insufficiency).toContain("2 distinct scan days");
    // The exact sentence the Delivery fit readout prints one click away — one vocabulary, one gate.
    expect(t.insufficiency).toContain("Not enough history to project");
  });

  it("refuses a short-SPAN fit too: enough days, not enough calendar", () => {
    const t = composeTrajectory(forecastTrajectory(series(50, 1, 5)));
    expect(t.headline).toBeNull();
    expect(t.insufficiency).toContain(`at least ${MIN_FORECAST_SPAN_DAYS}`);
  });

  it("says NOTHING at all when there is no fit — absence, never a fabricated basis (G4)", () => {
    expect(composeTrajectory(null)).toEqual({ headline: null, confidence: null, basis: null, insufficiency: null });
    // A one-point series cannot be fitted; same contract.
    expect(composeTrajectory(forecastTrajectory([{ date: "2026-01-01", value: 50 }]))).toEqual({
      headline: null,
      confidence: null,
      basis: null,
      insufficiency: null,
    });
  });

  it("carries BOTH halves of the hedge whenever it carries a headline — they are inseparable", () => {
    const f = forecastTrajectory(series(50, 0.3, 20))!;
    const t = composeTrajectory(f);
    expect(t.headline).toBe(forecastHeadline(f));
    expect(t.confidence).toBe(Math.round(f.fitQuality * 100));
    expect(t.basis).toBe(forecastBasis(f)); // forecastBasis finally has a non-test caller (DANA-L1-013)
    expect(t.insufficiency).toBeNull();
  });

  it("puts the compacted share in front of the reader when the fit rests on one", () => {
    const pts = series(50, 0.3, 20).map((p, i) => (i < 4 ? { ...p, compacted: true } : p));
    const t = composeTrajectory(forecastTrajectory(pts));
    expect(t.basis).toContain("4 of them compacted");
    expect(trajectoryNote(t)).toContain("4 of them compacted");
  });
});

describe("trajectoryNote / trajectoryLine — one line for the push surfaces", () => {
  it("joins confidence and basis, and marks a low-R² fit noisy", () => {
    const noisy = forecastTrajectory([
      { date: "2026-01-01", value: 50 },
      { date: "2026-01-08", value: 70 },
      { date: "2026-01-15", value: 52 },
      { date: "2026-01-22", value: 68 },
    ])!;
    const note = trajectoryNote(composeTrajectory(noisy))!;
    expect(note).toMatch(/^trend confidence \d+% · noisy · fit over 4 scan days across 21 days$/);
  });

  it("never emits a headline without its hedge attached", () => {
    const line = trajectoryLine(forecastTrajectory(series(50, 0.3, 20)))!;
    expect(line).toContain("trend confidence");
    expect(line).toContain("fit over 20 scan days across 19 days");
  });

  it("emits the refusal — not the slope — for an unpresentable fit, and nothing for no fit", () => {
    const line = trajectoryLine(
      forecastTrajectory([
        { date: "2026-08-21", value: 60 },
        { date: "2026-08-22", value: 65 },
      ]),
    )!;
    expect(line).toContain("Not enough history to project");
    expect(line).not.toContain("/wk"); // the bare slope the digest used to push
    expect(trajectoryLine(null)).toBeNull();
  });
});
