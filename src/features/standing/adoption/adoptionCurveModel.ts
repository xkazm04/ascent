// The adoption CURVE, as a pure view model.
//
// Adoption is a distribution, and the tab rendered it as three counts in a segmented bar — a shape
// stated as three numbers. What the org actually has is a survival curve: for a threshold t, what
// share of contributors carry at least t% AI-attributed work. `getContributorInsights` buckets that
// curve at exactly three thresholds (0, ≥1, ≥50), so the honest picture is three MEASURED points and
// an explicitly UNMEASURED band between them — never a smooth line implying we observed the interior.
//
// Pure: no React, no fetch, no DOM. The geometry, the `<title>` and the sr-only table are all built
// from this one model, so the accessible text cannot drift from the picture (the ProvenanceTrack
// discipline the report surface already holds).

/** The "heavy" band edge `getContributorInsights` buckets on (`aiShare >= 50`). */
export const HEAVY_THRESHOLD = 50;
/** The "any AI at all" edge. `aiShare` is a rounded integer percent, so (0, 1) holds no contributor. */
export const ANY_THRESHOLD = 1;

/** One observed point of the curve: contributors at or above `threshold`. */
export interface CurveMark {
  /** Personal AI-share threshold, 0..100. */
  threshold: number;
  /** Contributors at or above it. */
  count: number;
  /** `count` as a 0..100 share of the population. */
  share: number;
  /** Noun-phrase axis label, e.g. "≥50% AI". */
  label: string;
}

/**
 * A threshold interval with no measurement. The curve provably lies between `lo` and `hi` here
 * (it is non-increasing), but its shape inside is unobserved — drawn as a hatched `not-judged`
 * envelope, which is the whole reason the model carries bounds rather than an interpolated point.
 */
export interface CurveGap {
  from: number;
  to: number;
  /** Upper bound share (0..100) — the curve cannot rise above the mark on its left. */
  hi: number;
  /** Lower bound share (0..100) — the curve cannot fall below the mark on its right. */
  lo: number;
}

export interface AdoptionCurveModel {
  /** False → the caller renders a labelled placeholder rather than plotting a NaN. */
  ok: boolean;
  /** The population the shares are taken over. */
  total: number;
  marks: CurveMark[];
  gaps: CurveGap[];
  /**
   * Contributors counted in `total` that no bucket claims. A residual here is an ABSENCE — people we
   * have a headcount for but no AI-share reading on — and must never be folded into the "none"
   * bucket, which asserts a measured zero. Zero on every real payload; the guard exists because the
   * two counts arrive from different fields and a future producer change could split them.
   */
  unclassified: number;
  /** Commit-weighted org AI share (0..100), a reference tick on the threshold axis. Null = withheld. */
  orgShare: number | null;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function shareOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (count / total) * 100));
}

/**
 * Build the curve from the aggregate spread. `distribution` is computed over EVERY human (it
 * survives the naming floor), so this model is available on orgs whose per-person rows are withheld —
 * which is exactly when a picture matters most and a named list is unavailable.
 */
export function buildAdoptionCurve(
  distribution: { high: number; some: number; none: number },
  total: number,
  orgShare?: number | null,
): AdoptionCurveModel {
  const { high, some, none } = distribution;
  const counted = [high, some, none].every(isCount);
  const sum = counted ? high + some + none : 0;
  // A bucket sum ABOVE the headcount is incoherent, not merely partial — refuse to plot it.
  const ok = isCount(total) && total > 0 && counted && sum <= total;
  if (!ok) {
    return { ok: false, total: isCount(total) ? total : 0, marks: [], gaps: [], unclassified: 0, orgShare: null };
  }

  const anyCount = high + some;
  const marks: CurveMark[] = [
    { threshold: 0, count: total, share: 100, label: "any" },
    { threshold: ANY_THRESHOLD, count: anyCount, share: shareOf(anyCount, total), label: "≥1% AI" },
    { threshold: HEAVY_THRESHOLD, count: high, share: shareOf(high, total), label: "≥50% AI" },
  ];

  const anyShare = marks[1]!.share;
  const highShare = marks[2]!.share;
  const gaps: CurveGap[] = [
    { from: ANY_THRESHOLD, to: HEAVY_THRESHOLD, hi: anyShare, lo: highShare },
    // Above the heavy edge we know only that the curve stays at or under `highShare` and reaches 0
    // at 100% — the widest honest envelope on the chart, and the one a three-bucket read cannot
    // narrow. Omitted when nobody is heavy: an envelope from 0 to 0 draws a hairline that reads as
    // a measurement of "nobody above 50%", which is a claim about the interior we do not hold.
    { from: HEAVY_THRESHOLD, to: 100, hi: highShare, lo: 0 },
  ].filter((g) => g.hi > g.lo);

  return {
    ok: true,
    total,
    marks,
    gaps,
    unclassified: total - sum,
    orgShare: typeof orgShare === "number" && Number.isFinite(orgShare) ? Math.max(0, Math.min(100, orgShare)) : null,
  };
}

/** The generated accessible sentence — the same numbers the geometry is drawn from. */
export function curveSummary(m: AdoptionCurveModel): string {
  if (!m.ok) return "Adoption curve: no contributor population to plot.";
  const parts = m.marks.map((k) => `${k.count} of ${m.total} at ${k.label} (${Math.round(k.share)}%)`);
  const residual = m.unclassified > 0 ? ` ${m.unclassified} contributor(s) carry no AI-share reading at all — an absence, not a zero.` : "";
  return (
    `Adoption curve across ${m.total} contributors: ${parts.join(", ")}. ` +
    `The hatched band between thresholds is bounded but not measured.${residual}`
  );
}
