// Cross-org portfolio rollup — the "fleet of fleets" a PE / portfolio engineering lead needs to brief
// an investment committee on engineering risk + AI-readiness across the whole book in ONE comparable
// view (THEO). Every other dashboard is single-tenant by slug; this assembles N orgs' existing rollups
// into one table. Pure assembly over getOrgRollup/getOrgBenchmark — no new queries. Authorization (which
// orgs the viewer may read) is the CALLER's job (the page filters via canReadOrg) so this stays a pure
// data fetch that never leaks a tenant it was handed.

import { getOrgBenchmark, getOrgRollup } from "@/lib/db";
import { levelForScore } from "@/lib/maturity/model";
import { humanizeDays } from "@/lib/maturity/forecast";

export interface PortfolioCompany {
  org: string;
  scannedCount: number;
  avgOverall: number;
  levelId: string;
  levelName: string;
  adoption: number;
  rigor: number;
  /** Dominant posture across the company's fleet (ai-native | ungoverned | manual | early). */
  posture: string;
  trajectory: "rising" | "falling" | "flat" | null;
  /** Weekly rate of change (score pts/wk), or null when there's too little history to fit a trend. */
  perWeek: number | null;
  /** Promotion/demotion ETA label (e.g. "L4 in ~8 weeks"), or null when flat / not enough history. */
  etaLabel: string | null;
  /** Trend confidence (R² as 0..100) — low = the straight-line read is noisy (few quarterly points). */
  confidence: number | null;
  /** Corpus percentile (0..100), or null when there's no corpus yet. */
  percentile: number | null;
}

export interface Portfolio {
  companies: PortfolioCompany[];
  /** Simple mean maturity across companies (each company one vote, not repo-weighted). */
  avgOverall: number;
  rising: number;
  falling: number;
  flat: number;
  totalRepos: number;
}

/** The posture id with the most repos in a company's fleet; "—" when empty. */
export function topPosture(counts: Record<string, number>): string {
  let best = "—";
  let bestN = -1;
  for (const [id, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

/** Pure portfolio-level rollup over already-fetched companies: sort richest-first, mean maturity, and
 *  the rising/falling/flat split (a company with no fittable trend counts as flat). */
export function summarizePortfolio(companies: PortfolioCompany[]): Portfolio {
  const sorted = [...companies].sort((a, b) => b.avgOverall - a.avgOverall);
  const avgOverall = sorted.length ? Math.round(sorted.reduce((a, c) => a + c.avgOverall, 0) / sorted.length) : 0;
  return {
    companies: sorted,
    avgOverall,
    rising: sorted.filter((c) => c.trajectory === "rising").length,
    falling: sorted.filter((c) => c.trajectory === "falling").length,
    flat: sorted.filter((c) => c.trajectory === "flat" || c.trajectory === null).length,
    totalRepos: sorted.reduce((a, c) => a + c.scannedCount, 0),
  };
}

/**
 * Build the portfolio view for a set of org slugs the caller has ALREADY authorized. Fetches each org's
 * rollup + corpus benchmark in parallel; an org with no scanned repos (or an unreachable read) drops out
 * rather than showing a blank row.
 */
export async function buildPortfolio(orgSlugs: string[]): Promise<Portfolio> {
  const rows = await Promise.all(
    orgSlugs.map(async (org): Promise<PortfolioCompany | null> => {
      const [rollup, benchmark] = await Promise.all([
        getOrgRollup(org).catch(() => null),
        getOrgBenchmark(org).catch(() => null),
      ]);
      if (!rollup || rollup.scannedCount === 0) return null;
      const level = levelForScore(rollup.avgOverall);
      const f = rollup.forecast;
      return {
        org,
        scannedCount: rollup.scannedCount,
        avgOverall: rollup.avgOverall,
        levelId: level.id,
        levelName: level.name,
        adoption: rollup.avgAdoption,
        rigor: rollup.avgRigor,
        posture: topPosture(rollup.postureCounts),
        trajectory: f?.trajectory ?? null,
        perWeek: f?.perWeek ?? null,
        etaLabel: f?.eta ? `${f.eta.toLevel} in ${humanizeDays(f.eta.days)}` : null,
        // Same low-data caveat as the exec briefing: a <3-scan OLS fit is 100% by construction, so
        // don't surface fitQuality as a confidence % when `lowData` is set (forecast.ts warns on this).
        confidence: f && !f.lowData ? Math.round(f.fitQuality * 100) : null,
        percentile: benchmark?.overallPercentile ?? null,
      };
    }),
  );
  return summarizePortfolio(rows.filter((r): r is PortfolioCompany => r !== null));
}
