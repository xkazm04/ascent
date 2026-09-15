// The metric registry — metric-identity made structural. A metric is a NAME WITH A CONTRACT: id,
// label, unit, precision, polarity, window, source and ONE derivation. Every surface in the scene
// that shows "success rate" (the tile, the bars, the table cell, the tooltip) calls the same
// `derive()` and the same `fmtMetric()`; none holds a sum or a divide of its own. Where the product
// needs one display name over two windows, the divergence is REGISTERED — two ids, one computation —
// and each surface states its window where the number renders. No React.

import type { Total } from "./fixtures";

export type Polarity = "higher-better" | "lower-better";

export type MetricDef = {
  /** Stable id naming surface + window + source: dashboards reference this, never the label. */
  id: string;
  label: string;
  unit: "%" | "scans";
  precision: number;
  polarity: Polarity;
  /** Trailing COMPLETE buckets; the partial trailing bucket is excluded by contract. */
  windowDays: number;
  source: string;
  /** The one derivation. `null` when the metric cannot be measured — never a fabricated 0. */
  derive: (window: readonly Total[]) => number | null;
};

const sum = (w: readonly Total[], k: "scans" | "failed") => w.reduce((n, t) => n + t[k], 0);

/** Success rate over a window: null for an empty denominator — unmeasured is not 0%. */
const successRate = (w: readonly Total[]): number | null => {
  const scans = sum(w, "scans");
  return scans === 0 ? null : (1 - sum(w, "failed") / scans) * 100;
};

export const METRICS = {
  "success-rate.fleet.7d": {
    id: "success-rate.fleet.7d",
    label: "Scan success rate",
    unit: "%",
    precision: 1,
    polarity: "higher-better",
    windowDays: 7,
    source: "scan_runs (raw)",
    derive: successRate,
  },
  "success-rate.fleet.14d": {
    id: "success-rate.fleet.14d",
    label: "Scan success rate",
    unit: "%",
    precision: 1,
    polarity: "higher-better",
    windowDays: 14,
    source: "scan_runs (raw)",
    derive: successRate,
  },
  "failed-scans.fleet.7d": {
    id: "failed-scans.fleet.7d",
    label: "Failed scans",
    unit: "scans",
    precision: 0,
    polarity: "lower-better",
    windowDays: 7,
    source: "scan_runs (raw)",
    derive: (w) => (w.length === 0 ? null : sum(w, "failed")),
  },
} as const satisfies Record<string, MetricDef>;

export type MetricId = keyof typeof METRICS;

/** The trailing `windowDays` COMPLETE buckets ending `offset` windows ago (0 = current, 1 = previous). */
export function windowOf(def: MetricDef, totals: readonly Total[], offset = 0): Total[] {
  const complete = totals.filter((t) => !t.partial);
  const end = complete.length - offset * def.windowDays;
  const start = end - def.windowDays;
  // A window that would reach before the data is NOT a window: return nothing, so the derivation
  // reports null and the surface shows a dash rather than a number over a shorter span.
  if (start < 0) return [];
  return complete.slice(start, end);
}

/** The shared formatter — the tile, the tooltip and the table cell agree to the digit. */
export function fmtMetric(def: MetricDef, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const n = v.toFixed(def.precision);
  return def.unit === "%" ? `${n}%` : `${Number(n).toLocaleString()} ${def.unit}`;
}

/** Current value, previous-window value, and the delta between them (null when either is unmeasured). */
export function readMetric(def: MetricDef, totals: readonly Total[]) {
  const current = def.derive(windowOf(def, totals, 0));
  const previous = def.derive(windowOf(def, totals, 1));
  const delta = current === null || previous === null ? null : current - previous;
  return { current, previous, delta };
}

/**
 * Favourability from polarity: colour follows whether the move is GOOD, the arrow follows the sign.
 * Consumers hand this to `deltaHex` — a rising failed-scan count is a falling favourability.
 */
export function favourable(def: MetricDef, delta: number): number {
  return def.polarity === "lower-better" ? -delta : delta;
}

/** Rounded to the metric's own precision before it travels — precision is part of identity. */
export function rounded(def: MetricDef, v: number | null): number | null {
  return v === null ? null : Number(v.toFixed(def.precision));
}
