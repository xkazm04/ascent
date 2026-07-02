// Trajectory engine — fit a linear trend over a maturity-score time-series and project where
// it is heading: a forward-looking GPS layered on top of the rear-view trend. Pure, dependency-
// free, and deterministic given its inputs (never reads `Date.now()`), so it is trivially
// unit-testable and safe to call inside server queries.
//
// The slope comes from an ordinary-least-squares fit over (day-offset, score). The projection ray
// is anchored at the most recent *actual* value ("you are here") and extended along that slope;
// the ETA is the first maturity-band boundary the ray crosses — a promotion when rising, a
// demotion when falling. Fit quality (R²) is surfaced so consumers can judge how trustworthy a
// straight-line read is before acting on it.

import type { LevelId } from "@/lib/types";
import { LEVELS, LEVEL_BY_ID, clamp, levelForScore } from "@/lib/maturity/model";

/** One observation in a score time-series. `date` is an ISO date/datetime; `value` is 0..100. */
export interface SeriesPoint {
  date: string;
  value: number;
}

export type Trajectory = "rising" | "falling" | "flat";

/** ETA to the next maturity-band crossing along the current trajectory. */
export interface LevelEta {
  kind: "promotion" | "demotion";
  fromLevel: LevelId;
  toLevel: LevelId;
  /** The 0..100 score boundary the projection crosses. */
  boundary: number;
  /** Whole days from the most recent observation until the crossing. */
  days: number;
  /** Absolute ISO date (YYYY-MM-DD) of the projected crossing. */
  date: string;
}

/** A linear forecast over a maturity-score series. */
export interface Forecast {
  /** Distinct calendar days the fit used. */
  points: number;
  /** Calendar span of the series in days (last − first). */
  spanDays: number;
  /** Least-squares slope, in score-points per day. */
  perDay: number;
  /** Slope per week (perDay × 7), rounded to 0.1 — the human-facing rate. */
  perWeek: number;
  /** Most recent observed value — the trajectory's anchor ("you are here"). */
  current: number;
  currentLevel: LevelId;
  /** Days projected ahead for `projected` / `projectedLevel`. */
  horizonDays: number;
  /** Linear projection of the score `horizonDays` out, clamped 0..100. */
  projected: number;
  projectedLevel: LevelId;
  /** Goodness of fit (R²), 0..1 — how trustworthy the straight-line read is. */
  fitQuality: number;
  /** True when the fit rests on too few distinct days (< 3) to trust the R² as "confidence":
   *  OLS through 1–2 points fits perfectly by construction (ssRes=0 → fitQuality=1, degrees of
   *  freedom n−2 ≤ 0), so the LEAST trustworthy fit reports the HIGHEST confidence. Consumers must
   *  not render `fitQuality` as a hard confidence % when this is set — surface a "low data" caveat
   *  instead. (forecast-overconfidence: investment-simulator-forecast #1 / org-overview-standing #2.) */
  lowData: boolean;
  trajectory: Trajectory;
  /** Next promotion/demotion ETA, or null when flat, at a ceiling/floor, or beyond the horizon cap. */
  eta: LevelEta | null;
}

const DAY_MS = 86_400_000;

/** Below this absolute weekly drift we call the trend flat — noise, not a trajectory. */
const FLAT_PER_WEEK = 0.5;

/** Don't project a level change beyond this — past ~a year it's fantasy, not planning. */
const MAX_ETA_DAYS = 365;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fit a linear trajectory to a maturity-score series and project it forward.
 *
 * Returns null when there isn't enough signal to fit a line (fewer than two distinct calendar
 * days). Observations may arrive in any order and multiple-per-day; same-day points are collapsed
 * to their mean before fitting.
 *
 * @param series       observations; sorted and de-duplicated by day internally.
 * @param horizonDays  how far ahead to project the headline score (default 90 ≈ a quarter).
 */
export function forecastTrajectory(series: SeriesPoint[], horizonDays = 90): Forecast | null {
  const parsed = series
    .map((p) => ({ t: Date.parse(p.date), value: p.value }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value))
    .sort((a, b) => a.t - b.t);
  if (parsed.length < 2) return null;

  // Collapse to one point per calendar day (mean), indexed by whole days from the first day.
  const firstT = parsed[0]!.t; // safe: parsed.length >= 2 checked above
  const byDay = new Map<number, { sum: number; n: number }>();
  for (const p of parsed) {
    const day = Math.floor((p.t - firstT) / DAY_MS);
    const e = byDay.get(day) ?? { sum: 0, n: 0 };
    e.sum += p.value;
    e.n += 1;
    byDay.set(day, e);
  }
  const xs = [...byDay.keys()].sort((a, b) => a - b);
  if (xs.length < 2) return null; // every observation landed on one day → no slope to read
  const ys = xs.map((d) => byDay.get(d)!.sum / byDay.get(d)!.n);

  // Ordinary least squares over (dayOffset, score).
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX; // safe: i bounded by n = xs.length
    const dy = ys[i]! - meanY; // safe: ys has same length as xs
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const perDay = sxx === 0 ? 0 : sxy / sxx;

  // R²: share of variance the line explains. A perfectly flat series (syy = 0) fits exactly.
  const intercept = meanY - perDay * meanX;
  let ssRes = 0;
  for (let i = 0; i < n; i++) ssRes += (ys[i]! - (intercept + perDay * xs[i]!)) ** 2; // safe: i bounded by n = xs.length (ys same length)
  const fitQuality = syy === 0 ? 1 : clamp(1 - ssRes / syy, 0, 1);

  const lastT = parsed[parsed.length - 1]!.t; // safe: parsed.length >= 2 checked above
  const current = parsed[parsed.length - 1]!.value; // anchor on the latest actual value (safe: parsed non-empty)
  const spanDays = xs[xs.length - 1]!; // safe: xs.length >= 2 checked above
  const perWeek = round1(perDay * 7);

  const trajectory: Trajectory =
    Math.abs(perDay * 7) < FLAT_PER_WEEK ? "flat" : perDay > 0 ? "rising" : "falling";

  const projected = Math.round(clamp(current + perDay * horizonDays));

  return {
    points: n,
    spanDays,
    perDay: round2(perDay),
    perWeek,
    current: Math.round(current),
    currentLevel: levelForScore(current).id,
    horizonDays,
    projected,
    projectedLevel: levelForScore(projected).id,
    fitQuality: round2(fitQuality),
    // < 3 distinct days → R² is 1 by construction, not by trend (no degrees of freedom). Flag it so
    // the UI doesn't read a 2-point blip as rock-solid "100% confidence".
    lowData: n < 3,
    trajectory,
    eta: trajectory === "flat" ? null : etaToNextLevel(current, perDay, lastT),
  };
}

/** The first band boundary the projection ray crosses, anchored at `current` with slope `perDay`. */
function etaToNextLevel(current: number, perDay: number, lastT: number): LevelEta | null {
  if (perDay === 0) return null;
  // Bucket on the SAME rounded+clamped score levelForScore/currentLevel use (bands are contiguous
  // integers, so a fractional `current` like 64.7 sits in no band → findIndex -1 → defaulted to L1,
  // producing a null/contradictory ETA whose fromLevel disagreed with currentLevel). Rounding once at
  // entry keeps band-bucketing consistent with the rest of the module. (investment-simulator-forecast #4)
  const score = clamp(Math.round(current));
  const idx = LEVELS.findIndex((l) => score >= l.band[0] && score <= l.band[1]);
  const i = idx < 0 ? 0 : idx;
  const rising = perDay > 0;

  let boundary: number;
  let toLevel: LevelId;
  if (rising) {
    if (i >= LEVELS.length - 1) return null; // already at the ceiling (L5)
    boundary = LEVELS[i + 1]!.band[0]; // e.g. L3→L4 crosses 65 (safe: i+1 < LEVELS.length, guarded above)
    toLevel = LEVELS[i + 1]!.id; // safe: i+1 < LEVELS.length, guarded above
  } else {
    if (i <= 0) return null; // already at the floor (L1)
    boundary = LEVELS[i - 1]!.band[1]; // e.g. L3→L2 crosses 44 (safe: i-1 >= 0, guarded above)
    toLevel = LEVELS[i - 1]!.id; // safe: i-1 >= 0, guarded above
  }

  const exactDays = (boundary - score) / perDay;
  if (!Number.isFinite(exactDays) || exactDays <= 0 || exactDays > MAX_ETA_DAYS) return null;
  const days = Math.round(exactDays);

  return {
    kind: rising ? "promotion" : "demotion",
    fromLevel: LEVELS[i]!.id, // safe: i is a valid LEVELS index (clamped to 0 or a findIndex hit)
    toLevel,
    boundary,
    days,
    date: new Date(lastT + days * DAY_MS).toISOString().slice(0, 10),
  };
}

// ── Goal pacing ──────────────────────────────────────────────────────────────
// Where the level-band ETA above asks "when do we cross the next maturity band", a *goal* asks
// "when do we reach this specific target, and is that before the deadline". Same OLS slope, a
// target line instead of a band boundary, and a verdict against an (optional) target date.

/** Read of a goal's pace against its target (and deadline, if any). */
export type GoalPace = "reached" | "on-pace" | "behind" | "tracking";

/** A projection of a single goal: its trend slope, the ETA to the target, and the pace verdict. */
export interface GoalProjection {
  pace: GoalPace;
  /** Current weekly rate of change of the metric (0 when there's no fittable trend). */
  perWeek: number;
  trajectory: Trajectory;
  /** R² of the underlying fit, 0..1 — how trustworthy the slope is. */
  fitQuality: number;
  /** Whole days from now until the metric reaches the target at the current slope, or null. */
  etaDays: number | null;
  /** Absolute ISO date (YYYY-MM-DD) of the projected target crossing, or null. */
  etaDate: string | null;
  /** Weekly gain required to reach the target by the deadline, or null (no deadline / past due / reached). */
  requiredPerWeek: number | null;
  /** Whole days from now to the deadline (negative if past), or null when no deadline is set. */
  daysToDeadline: number | null;
}

/** A goal's ETA is fantasy beyond this — flatter than "reaches target in ~3 years" reads as "behind". */
const GOAL_ETA_CAP_DAYS = 1095;

/**
 * Project a goal forward: fit the metric's trend, extend it from `current` to the `target` line,
 * and judge the pace against `targetDate`. Pure and deterministic — `nowMs` is injected (the
 * present), never read, so this stays unit-testable like the rest of this module.
 *
 * Verdict: `reached` once current ≥ target; otherwise, with a deadline, `on-pace` when the
 * projected crossing lands on/before it and `behind` when it lands after (or the trend is flat/
 * falling, so the target is never reached at this pace). With no deadline — or not enough trend to
 * fit a slope yet — the verdict is the neutral `tracking` (the ETA still shows when one exists).
 */
export function projectGoal(opts: {
  series: SeriesPoint[];
  current: number;
  target: number;
  targetDate: string | null;
  nowMs: number;
}): GoalProjection {
  const { series, current, target, targetDate, nowMs } = opts;
  const fit = forecastTrajectory(series); // null when there's < 2 distinct days to fit
  const perDay = fit?.perDay ?? 0;

  const deadlineMs = targetDate ? Date.parse(targetDate) : NaN;
  const hasDeadline = Number.isFinite(deadlineMs);
  const daysToDeadline = hasDeadline ? Math.round((deadlineMs - nowMs) / DAY_MS) : null;

  // Days/date to reach the target at the current (rising) slope.
  let etaDays: number | null = null;
  let etaDate: string | null = null;
  if (current < target && perDay > 0) {
    const d = Math.round((target - current) / perDay);
    if (Number.isFinite(d) && d >= 0 && d <= GOAL_ETA_CAP_DAYS) {
      etaDays = d;
      etaDate = new Date(nowMs + d * DAY_MS).toISOString().slice(0, 10);
    }
  }

  // Weekly gain still needed to make the deadline (only meaningful while there's time left).
  let requiredPerWeek: number | null = null;
  if (hasDeadline && current < target) {
    const daysLeft = (deadlineMs - nowMs) / DAY_MS;
    if (daysLeft > 0) requiredPerWeek = round1(((target - current) / daysLeft) * 7);
  }

  let pace: GoalPace;
  if (current >= target) pace = "reached";
  else if (!hasDeadline || !fit) pace = "tracking";
  else if (etaDate && Date.parse(etaDate) <= deadlineMs) pace = "on-pace";
  else pace = "behind";

  return {
    pace,
    perWeek: fit?.perWeek ?? 0,
    trajectory: fit?.trajectory ?? "flat",
    fitQuality: fit?.fitQuality ?? 0,
    etaDays,
    etaDate,
    requiredPerWeek,
    daysToDeadline,
  };
}

/** Coarse, friendly duration for a forecast horizon ("~3 days", "~8 weeks", "~5 months"). */
export function humanizeDays(days: number): string {
  if (days <= 1) return "~1 day";
  if (days < 14) return `~${days} days`;
  if (days < 60) return `~${Math.round(days / 7)} weeks`;
  return `~${Math.round(days / 30)} months`;
}

/** One-line, leader-facing read of a forecast — the headline for the trajectory GPS. */
export function forecastHeadline(f: Forecast): string {
  const lvl = (id: LevelId) => `${id} · ${LEVEL_BY_ID[id].name}`;
  if (f.eta) {
    const when = humanizeDays(f.eta.days);
    return f.eta.kind === "promotion"
      ? `On track to reach ${lvl(f.eta.toLevel)} in ${when} (≈ ${f.eta.date}).`
      : `At risk of slipping to ${lvl(f.eta.toLevel)} in ${when} (≈ ${f.eta.date}).`;
  }
  if (f.trajectory === "flat")
    return `Holding around ${f.current} (${lvl(f.currentLevel)}) — no level change projected.`;
  const dir = f.trajectory === "rising" ? "Climbing" : "Declining";
  const rate = `${f.perWeek > 0 ? "+" : ""}${f.perWeek}/wk`;
  return `${dir} at ${rate}, staying within ${lvl(f.currentLevel)} for now.`;
}
