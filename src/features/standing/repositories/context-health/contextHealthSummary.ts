// The fleet-level rollup of the Context Health rows — extracted from contextHealthModel.ts so every
// file stays under the 200-LOC cap (AGENTS.md), and re-exported from there so callers are unchanged.
//
// Pure aggregation, no synthesis: it only folds rows the model already built off persisted scan
// output, and it carries the same honesty rules — `assessed:false` rows are excluded from every
// denominator rather than counted as "no context", `potency:null` rows are excluded from the
// freshness denominator rather than assumed fresh, and the staleness counts stay APPROXIMATE
// (weekly-bucket derived), so copy must say ≈.

import type { RepoContextRow } from "./contextHealthModel";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

export interface ContextFleetSummary {
  repos: number;
  /** Rows whose latest scan measured context health. */
  assessed: number;
  /** Scanned before the signal existed — the re-scan cohort. */
  notAssessed: number;
  /** Assessed repos carrying at least one guidance file. */
  withContext: number;
  /** Coverage %: withContext / assessed. Null until anything is assessed. */
  coveragePct: number | null;
  /** Median ≈commits-since-edit across repos with known freshness. */
  medianStalenessCommits: number | null;
  /** Median projected half-life (days) across moving repos with context. */
  medianHalfLifeDays: number | null;
  /** Repos whose context has decayed past its own half-life (potency < 50). */
  pastHalfLife: number;
  /** Repos with known freshness (the pastHalfLife denominator). */
  freshnessKnown: number;
  /** Σ ≈commits landed since each repo's context was last edited. */
  unguidedCommits: number;
  deadRefRepos: number;
  deadRefsTotal: number;
}

export function fleetContextSummary(rows: RepoContextRow[]): ContextFleetSummary {
  const assessed = rows.filter((r) => r.assessed);
  const withContext = assessed.filter((r) => r.present);
  const known = withContext.filter((r) => r.potency != null);
  const halves = withContext
    .map((r) => r.halfLifeDays)
    .filter((d): d is number => d != null && Number.isFinite(d));
  return {
    repos: rows.length,
    assessed: assessed.length,
    notAssessed: rows.filter((r) => r.scanned && !r.assessed).length,
    withContext: withContext.length,
    coveragePct: assessed.length ? Math.round((withContext.length / assessed.length) * 100) : null,
    medianStalenessCommits: median(known.map((r) => r.commitsSinceEdit ?? 0)),
    medianHalfLifeDays: (() => {
      const m = median(halves);
      return m == null ? null : Math.round(m);
    })(),
    pastHalfLife: known.filter((r) => (r.potency ?? 100) < 50).length,
    freshnessKnown: known.length,
    unguidedCommits: known.reduce((a, r) => a + (r.commitsSinceEdit ?? 0), 0),
    deadRefRepos: withContext.filter((r) => r.deadRefs.length > 0).length,
    deadRefsTotal: withContext.reduce((a, r) => a + r.deadRefs.length, 0),
  };
}
