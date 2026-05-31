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
  const firstT = parsed[0].t;
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
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const perDay = sxx === 0 ? 0 : sxy / sxx;

  // R²: share of variance the line explains. A perfectly flat series (syy = 0) fits exactly.
  const intercept = meanY - perDay * meanX;
  let ssRes = 0;
  for (let i = 0; i < n; i++) ssRes += (ys[i] - (intercept + perDay * xs[i])) ** 2;
  const fitQuality = syy === 0 ? 1 : clamp(1 - ssRes / syy, 0, 1);

  const lastT = parsed[parsed.length - 1].t;
  const current = parsed[parsed.length - 1].value; // anchor on the latest actual value
  const spanDays = xs[xs.length - 1];
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
    trajectory,
    eta: trajectory === "flat" ? null : etaToNextLevel(current, perDay, lastT),
  };
}

/** The first band boundary the projection ray crosses, anchored at `current` with slope `perDay`. */
function etaToNextLevel(current: number, perDay: number, lastT: number): LevelEta | null {
  if (perDay === 0) return null;
  const idx = LEVELS.findIndex((l) => current >= l.band[0] && current <= l.band[1]);
  const i = idx < 0 ? 0 : idx;
  const rising = perDay > 0;

  let boundary: number;
  let toLevel: LevelId;
  if (rising) {
    if (i >= LEVELS.length - 1) return null; // already at the ceiling (L5)
    boundary = LEVELS[i + 1].band[0]; // e.g. L3→L4 crosses 65
    toLevel = LEVELS[i + 1].id;
  } else {
    if (i <= 0) return null; // already at the floor (L1)
    boundary = LEVELS[i - 1].band[1]; // e.g. L3→L2 crosses 44
    toLevel = LEVELS[i - 1].id;
  }

  const exactDays = (boundary - current) / perDay;
  if (!Number.isFinite(exactDays) || exactDays <= 0 || exactDays > MAX_ETA_DAYS) return null;
  const days = Math.round(exactDays);

  return {
    kind: rising ? "promotion" : "demotion",
    fromLevel: LEVELS[i].id,
    toLevel,
    boundary,
    days,
    date: new Date(lastT + days * DAY_MS).toISOString().slice(0, 10),
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
