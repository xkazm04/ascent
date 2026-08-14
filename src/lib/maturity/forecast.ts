// Trajectory engine — fit a linear trend over a maturity-score time-series and project where
// it is heading: a forward-looking GPS layered on top of the rear-view trend. Dependency-free and
// deterministic given its inputs: the OLS fit reads no clock, and the only "now"-dependent output —
// the ETA's absolute date — takes an injectable `nowMs` (default `Date.now()`), so tests pass a fixed
// value and the module stays trivially unit-testable and safe inside server queries.
//
// The slope comes from an ordinary-least-squares fit over (day-offset, score). The projection ray
// is anchored at the most recent *actual* value ("you are here") and extended along that slope;
// the ETA is the first maturity-band boundary the ray crosses — a promotion when rising, a
// demotion when falling — with its days/date measured forward from `nowMs` so a stale scan gap never
// prints a crossing date that has already elapsed. Fit quality (R²) is surfaced so consumers can judge
// how trustworthy a straight-line read is before acting on it.

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
  /** Whole days from `nowMs` (the caller's present, default: the clock) until the crossing. */
  days: number;
  /** Absolute ISO date (YYYY-MM-DD) of the projected crossing, measured forward from `nowMs`. */
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
 * Collapse keyed observations to one MEAN value per day-key, at full precision (no rounding).
 * Single-sources the `{ sum, n }`-per-key accumulation shared by `forecastTrajectory` below (which
 * keys by integer day-offset for its OLS x-axis) and `plan.ts`'s `dailyAvg` (which keys by ISO
 * `YYYY-MM-DD` and rounds each mean afterwards). Returns a Map in first-seen insertion order;
 * callers sort the keys themselves. Generic over the key so each caller keeps its own day semantics.
 */
export function meanPerDayKey<T extends { value: number }, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, number> {
  const acc = new Map<K, { sum: number; n: number }>();
  for (const it of items) {
    const k = keyOf(it);
    const e = acc.get(k);
    if (e) {
      e.sum += it.value;
      e.n += 1;
    } else {
      acc.set(k, { sum: it.value, n: 1 });
    }
  }
  const out = new Map<K, number>();
  for (const [k, e] of acc) out.set(k, e.sum / e.n);
  return out;
}

/**
 * Fit a linear trajectory to a maturity-score series and project it forward.
 *
 * Returns null when there isn't enough signal to fit a line (fewer than two distinct calendar
 * days). Observations may arrive in any order and multiple-per-day; same-day points are collapsed
 * to their mean before fitting.
 *
 * @param series       observations; sorted and de-duplicated by day internally.
 * @param horizonDays  how far ahead to project the headline score (default 90 ≈ a quarter).
 * @param nowMs        the caller's "present" for anchoring the ETA (default: `Date.now()`). The slope
 *                     fit itself never reads it — only the ETA's absolute date does — so pass a fixed
 *                     value in tests to stay deterministic. Anchoring the ETA on NOW (not the last
 *                     observation) is what stops a stale scan gap from printing a crossing date that has
 *                     already elapsed (investment-simulator-forecast #4).
 */
export function forecastTrajectory(series: SeriesPoint[], horizonDays = 90, nowMs: number = Date.now()): Forecast | null {
  const parsed = series
    .map((p) => ({ t: Date.parse(p.date), value: p.value }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value))
    .sort((a, b) => a.t - b.t);
  if (parsed.length < 2) return null;

  // Collapse to one point per calendar day (mean), indexed by whole days from the first day.
  const firstT = parsed[0]!.t; // safe: parsed.length >= 2 checked above
  const dayMeans = meanPerDayKey(parsed, (p) => Math.floor((p.t - firstT) / DAY_MS));
  const xs = [...dayMeans.keys()].sort((a, b) => a - b);
  if (xs.length < 2) return null; // every observation landed on one day → no slope to read
  const ys = xs.map((d) => dayMeans.get(d)!); // safe: d ∈ dayMeans.keys()

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
    eta: trajectory === "flat" ? null : etaToNextLevel(current, perDay, lastT, nowMs),
  };
}

/**
 * The first band boundary the projection ray crosses. The ray is anchored at (`lastT`, `current`), but
 * the returned `days`/`date` are measured from `nowMs` — so when the latest scan is stale, a crossing
 * the ray places before `nowMs` is reported as "already reached" (null) rather than a bogus past ETA.
 */
function etaToNextLevel(current: number, perDay: number, lastT: number, nowMs: number): LevelEta | null {
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

  const exactDaysFromLast = (boundary - score) / perDay;
  if (!Number.isFinite(exactDaysFromLast)) return null;
  // Absolute instant the ray crosses the boundary, then re-measured from `nowMs` (not `lastT`). A stale
  // scan gap (nowMs ≫ lastT) shrinks the remaining distance; once the crossing is at/behind the present,
  // daysFromNow ≤ 0 and we return null instead of a crossing date that has already passed. When nowMs is
  // the last observation (the pure/back-compat default anchor) this reduces to the old from-last math.
  const crossingMs = lastT + exactDaysFromLast * DAY_MS;
  const daysFromNow = (crossingMs - nowMs) / DAY_MS;
  if (!Number.isFinite(daysFromNow) || daysFromNow <= 0 || daysFromNow > MAX_ETA_DAYS) return null;
  const days = Math.round(daysFromNow);

  return {
    kind: rising ? "promotion" : "demotion",
    fromLevel: LEVELS[i]!.id, // safe: i is a valid LEVELS index (clamped to 0 or a findIndex hit)
    toLevel,
    boundary,
    days,
    date: new Date(nowMs + days * DAY_MS).toISOString().slice(0, 10),
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
  const fit = forecastTrajectory(series, 90, nowMs); // inject nowMs so the fit stays deterministic; null when < 2 distinct days
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

// ── Presentability of a fit ──────────────────────────────────────────────────
// `forecastTrajectory` will happily fit a line through two scans a day apart and hand back an ETA:
// the maths is sound, the *claim* is not. A slope read off a 1-day span extrapolated to a promotion
// date is noise wearing a lab coat. `lowData` catches the degenerate n < 3 case (R² = 1 by
// construction), but n alone is not enough — five scans inside one busy afternoon are still one
// afternoon. So presentation also requires a real calendar SPAN behind the slope.
//
// This is the shared gate for every surface that renders a forecast, so "we don't project from a
// 5-day sample" means the same thing on the repo trends page and on the org rollup.
// (G5-01 / G4-16.)

/** Distinct scan days a fit needs before its ETA may be shown (below this, R² is 1 by construction). */
export const MIN_FORECAST_POINTS = 3;

/** Calendar days a fit must SPAN before its ETA may be shown — a slope off a few days is noise. */
export const MIN_FORECAST_SPAN_DAYS = 14;

/** Why a fit isn't presentable, or null when it is. Copy-ready, caller renders it verbatim. */
export function forecastInsufficiency(f: Forecast | null): string | null {
  if (!f) return "Not enough history to project: a trend needs at least two scans on different days.";
  if (f.points < MIN_FORECAST_POINTS)
    return `Not enough history to project: ${f.points} distinct scan ${f.points === 1 ? "day" : "days"} (a line through ≤ 2 points fits perfectly no matter how noisy the data).`;
  if (f.spanDays < MIN_FORECAST_SPAN_DAYS)
    return `Not enough history to project: this fit spans ${f.spanDays} ${f.spanDays === 1 ? "day" : "days"}; a trajectory needs at least ${MIN_FORECAST_SPAN_DAYS}.`;
  return null;
}

/** True when a fit rests on enough distinct days AND enough calendar span to be worth projecting. */
export function isProjectable(f: Forecast | null): f is Forecast {
  return forecastInsufficiency(f) === null;
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
    return `Holding around ${f.current} (${lvl(f.currentLevel)}), no level change projected.`;
  const dir = f.trajectory === "rising" ? "Climbing" : "Declining";
  const rate = `${f.perWeek > 0 ? "+" : ""}${f.perWeek}/wk`;
  return `${dir} at ${rate}, staying within ${lvl(f.currentLevel)} for now.`;
}
