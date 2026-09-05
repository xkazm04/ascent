import type { DimensionId, ScanReport } from "@/lib/types";
import type { RepositoryHistory } from "@/lib/db/scans";
import { axisScore } from "@/lib/maturity/model";
import { type TrendPoint } from "@/components/report/TrendChart";

export type ReportSeries = {
  scans: RepositoryHistory["scans"];
  trendPoints: TrendPoint[];
  overallDelta: number | null;
  prevDimScores: Map<string, number> | null;
  prevPosture: { adoption: number; rigor: number } | null;
  dimSeries: Map<string, TrendPoint[]> | null;
};

// Reconcile the live report with persisted history. `history.scans` is newest-first and
// MAY already include the scan being viewed (it can be persisted mid-stream) — or may not,
// if the history fetch raced the write. Identify whether the current scan is stored (by
// timestamp), and pick the baseline for deltas as the most recent scan STRICTLY older than
// this report. This keeps the headline ring's "since last scan" delta and the trend line's
// last point in agreement: no double-counting when the current scan IS stored, and no
// skipping the true previous when it ISN'T.
// All of the below is pure history×report shaping (including dimSeries, which rebuilds a Map over up
// to `limit` scans × |dimensions|). Callers memoize on [history, report] so switching the section tab —
// which re-renders via `tab`/`recs`/`fetchedPassport` state — doesn't recompute the whole series set.
export function computeReportSeries(history: RepositoryHistory | null, report: ScanReport): ReportSeries {
  const scans = history?.scans ?? [];
  // Reconcile by parsed INSTANT, not byte-identical ISO strings. The stored scannedAt
  // (Date.toISOString) and the live report.scannedAt are serialized independently and can differ by a
  // character (ms precision, "+00:00" vs "Z") for the same instant — an exact-string compare would
  // then mis-detect the current scan as absent and append a phantom duplicate trend point, and a
  // lexicographic "<" diverges from chronological order under mixed ISO offsets. Match within a 1s
  // tolerance; fall back to raw-string compare only when a timestamp isn't Date-parseable.
  const reportAt = Date.parse(report.scannedAt);
  const sameInstant = (a: string) => {
    const ta = Date.parse(a);
    return Number.isNaN(ta) || Number.isNaN(reportAt) ? a === report.scannedAt : Math.abs(ta - reportAt) < 1000;
  };
  const currentStored = scans.some((s) => sameInstant(s.scannedAt));
  // Baseline = most recent scan STRICTLY older than this report (and not the current scan itself,
  // which can be stored at a near-identical instant), compared as instants rather than lexically.
  const baselineScan =
    scans.find((s) => {
      const ts = Date.parse(s.scannedAt);
      if (Number.isNaN(ts) || Number.isNaN(reportAt)) return s.scannedAt < report.scannedAt;
      return ts < reportAt && !sameInstant(s.scannedAt);
    }) ?? null;

  // Overall-score series (oldest → newest). Append the current point when it isn't persisted
  // yet, so the last trend dot always matches the ScoreRing rather than omitting it.
  const trendPoints: TrendPoint[] = (() => {
    const chrono: TrendPoint[] = [...scans]
      .reverse()
      .map((s) => ({ score: s.overallScore, at: s.scannedAt, engine: s.engineProvider }));
    if (!currentStored)
      chrono.push({ score: report.overallScore, at: report.scannedAt, engine: report.engine.provider });
    return chrono;
  })();

  const overallDelta = baselineScan ? report.overallScore - baselineScan.overallScore : null;
  const prevDimScores = baselineScan ? new Map(baselineScan.dimensions.map((d) => [d.dimId, d.score])) : null;

  // Baseline scan's posture position, for the quadrant trail. Persisted history doesn't store
  // the archetype, so re-roll the axes under the current lens (a faithful-enough trail).
  const prevPosture = baselineScan
    ? (() => {
        const m = new Map(baselineScan.dimensions.map((d) => [d.dimId as DimensionId, d.score]));
        const scoreFor = (id: DimensionId) => m.get(id) ?? 0;
        return {
          adoption: axisScore("adoption", scoreFor, report.archetype),
          rigor: axisScore("rigor", scoreFor, report.archetype),
        };
      })()
    : null;

  // Per-dimension score series (chronological) for sparklines. Append the current report as
  // the last point when it isn't persisted yet, and push ONLY scores that are present in
  // each scan (a dimension absent from an older scan yields a shorter series — a gap — never
  // a fabricated 0).
  const dimSeries = (() => {
    const chrono: { at: string; engine: string; dimensions: { dimId: string; score: number }[] }[] = [
      ...scans,
    ]
      .reverse()
      .map((s) => ({ at: s.scannedAt, engine: s.engineProvider, dimensions: s.dimensions }));
    if (!currentStored) {
      chrono.push({
        at: report.scannedAt,
        engine: report.engine.provider,
        dimensions: report.dimensions.map((d) => ({ dimId: d.id, score: d.score })),
      });
    }
    if (chrono.length < 2) return null;
    const m = new Map<string, TrendPoint[]>();
    for (const s of chrono) {
      for (const d of s.dimensions) {
        const arr = m.get(d.dimId) ?? [];
        arr.push({ score: d.score, at: s.at, engine: s.engine });
        m.set(d.dimId, arr);
      }
    }
    return m;
  })();

  return { scans, trendPoints, overallDelta, prevDimScores, prevPosture, dimSeries };
}
