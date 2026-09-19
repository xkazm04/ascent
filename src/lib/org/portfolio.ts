// Cross-org portfolio rollup — the "fleet of fleets" a PE / portfolio engineering lead needs to brief
// an investment committee on engineering risk + AI-readiness across the whole book in ONE comparable
// view (THEO). Every other dashboard is single-tenant by slug; this assembles N orgs' existing rollups
// into one table. Pure assembly over getOrgRollup/getOrgBenchmark — no new queries. Authorization (which
// orgs the viewer may read) is the CALLER's job (the page filters via canReadOrg) so this stays a pure
// data fetch that never leaks a tenant it was handed.

import { getOrgBenchmark, getOrgRollup } from "@/lib/db";
import { hasFleetGrade } from "@/lib/db/org-shared";
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

/** Tagged portfolio assembly: graded companies plus the two honest misses that used to share one drop. */
export interface PortfolioRead {
  portfolio: Portfolio;
  /** Readable orgs whose rollup succeeded but had no live-scored fleet. Absence, not a 0. */
  empty: string[];
  /** Readable orgs whose rollup threw or returned null (persistence off / read failure). */
  unavailable: string[];
}

export type PortfolioEmptyKind = "prompt" | "no-access" | "no-scans" | "read-failure";

export const PORTFOLIO_EMPTY_COPY: Record<PortfolioEmptyKind, { title: string; body: string }> = {
  prompt: {
    title: "Add organizations to compare",
    body: "Enter a few organization slugs above (e.g. vercel, prisma) to roll up their engineering maturity side by side.",
  },
  "no-access": {
    title: "No read access",
    body: "None of the requested organizations are readable by you. That is not a claim they have no scans.",
  },
  "no-scans": {
    title: "No scans yet",
    body: "The organizations you can read have no live-scored repositories yet. That absence is not a score of 0.",
  },
  "read-failure": {
    title: "Portfolio unavailable",
    body: "The fleet rollup could not be read. Persistence is off, or the read failed. That is not a claim that none of these organizations have scans.",
  },
};

/**
 * Which empty the /portfolio page may render. The three G4 misses are exclusive: no-access is
 * authorization, no-scans is a successful empty read, read-failure is an unread rollup. A failed
 * read is never presented as "no scans".
 */
export function portfolioEmptyKind(args: {
  requested: number;
  readable: number;
  companies: number;
  empty: number;
  unavailable: number;
}): PortfolioEmptyKind | null {
  if (args.companies > 0) return null;
  if (args.requested <= 0) return "prompt";
  if (args.readable <= 0) return "no-access";
  if (args.unavailable > 0) return "read-failure";
  return "no-scans";
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

type PortfolioOrgRead =
  | { kind: "ok"; company: PortfolioCompany }
  | { kind: "empty"; org: string }
  | { kind: "unavailable"; org: string };

async function readPortfolioOrg(org: string): Promise<PortfolioOrgRead> {
  const [rollupSettled, benchmark] = await Promise.all([
    getOrgRollup(org).then(
      (r) => (r ? ({ ok: true as const, rollup: r }) : ({ ok: false as const })),
      () => ({ ok: false as const }),
    ),
    getOrgBenchmark(org).catch(() => null),
  ]);
  if (!rollupSettled.ok) return { kind: "unavailable", org };
  const { rollup } = rollupSettled;
  // Was `scannedCount === 0`. That let an all-MOCK fleet through — scanned, but not graded — and
  // `levelForScore(0)` then published it to the portfolio as a real L1 at 0/100, ranked below every
  // measured org. `hasFleetGrade` is the same drop rule against the population the averages are
  // actually over, and it narrows all three for the row below. A successful ungraded read is empty,
  // not a failed one.
  if (!hasFleetGrade(rollup)) return { kind: "empty", org };
  const level = levelForScore(rollup.avgOverall);
  const f = rollup.forecast;
  return {
    kind: "ok",
    company: {
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
    },
  };
}

/**
 * Build the portfolio view for a set of org slugs the caller has ALREADY authorized. Fetches each org's
 * rollup + corpus benchmark in parallel. A live-scored org becomes a row; a successful read with no
 * fleet grade is `empty`; a thrown or null rollup is `unavailable`. Those two misses must not share
 * one drop — the page names them separately.
 */
export async function buildPortfolio(orgSlugs: string[]): Promise<PortfolioRead> {
  const rows = await Promise.all(orgSlugs.map(readPortfolioOrg));
  const companies: PortfolioCompany[] = [];
  const empty: string[] = [];
  const unavailable: string[] = [];
  for (const row of rows) {
    if (row.kind === "ok") companies.push(row.company);
    else if (row.kind === "empty") empty.push(row.org);
    else unavailable.push(row.org);
  }
  return { portfolio: summarizePortfolio(companies), empty, unavailable };
}
