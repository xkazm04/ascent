// Public-corpus benchmarking. Sample eligibility, floors and org-vs-org comparison live together.
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug, mean, roundedMean } from "@/lib/db/org-shared";
import { BENCHMARK_ELIGIBLE, COHORT_MIN, CORPUS_BASIS, CORPUS_MIN } from "@/lib/corpus/eligibility";


// ── F6: benchmark vs the Ascent corpus ────────────────────────────────────────

export interface OrgBenchmark {
  corpusRepos: number; // repos in the comparison corpus (other orgs)
  /** What the corpus was filtered to — carried so every surface that renders a percentile can state
   *  the basis rather than implying "every repo Ascent has ever seen". `rubric` is the scoring rubric
   *  version both sides were required to match; `excludesMockEngine` records that deterministic-floor
   *  scans were held out. A percentile without its basis is not an auditable number. */
  corpusBasis: { rubric: string; excludesMockEngine: true };
  overallPercentile: number | null; // org mean overall vs OTHER ORGS' means (null below CORPUS_MIN peer orgs — a 1-org corpus would rank everyone 0th or 100th)
  corpusAvgOverall: number;
  corpusAvgAdoption: number;
  corpusAvgRigor: number;
  /** Peer cohort — corpus repos sharing this org's dominant primary language, for a "vs your peers"
   *  read (more meaningful than the whole corpus). Null when the org has no dominant language or no
   *  same-language peers exist; the percentiles are null below COHORT_MIN peer ORGS (too few to rank). */
  cohort: {
    language: string;
    repos: number;
    overallPercentile: number | null;
    adoptionPercentile: number | null;
    avgOverall: number;
  } | null;
}


/** Upper bound on the cross-tenant corpus materialized into Node for a benchmark (fleet-rollups-insights
 *  #5). The corpus is a percentile SAMPLE, not an exact population, so a bounded recent slice is enough —
 *  and it caps the cross-org read so one tenant's benchmark can't pull the entire fleet into memory. */
const BENCHMARK_CORPUS_CAP = 5000;


/** Share of `xs` at-or-below `v`, as 0..100 — null below `min` samples, because a 1-repo corpus
 *  ranks everyone a hard 0th or 100th percentile (no-sample is not a rank). Pure, for unit tests.
 *
 *  `v` is nullable for the mirror-image reason: an org with no eligible scan has no mean, and a rank
 *  needs something TO rank. Coalescing that absence to 0 would place the org at a real 0th percentile
 *  — "worse than every peer" — which is a measurement it does not have. Both no-population cases
 *  return the same null the type already carried for the too-few-samples case. */
export function percentileOf(xs: readonly number[], v: number | null, min = 1): number | null {
  if (v === null) return null;
  if (xs.length < Math.max(1, min)) return null;
  return Math.round((xs.filter((x) => x <= v).length / xs.length) * 100);
}


/** Compare an org's averages against every other repo Ascent has scored (the corpus), plus a
 *  same-language peer cohort for a sharper "vs your peers" read. */
export async function getOrgBenchmark(orgSlug: string): Promise<OrgBenchmark | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  // Latest scan + primary language per repo, for every repo NOT in this org. `orgId` is carried so the
  // percentile comparison can be done org-vs-org (like-for-like), not org-mean-vs-repo-distribution.
  // Capped + filtered (fleet-rollups-insights #5): the old query pulled EVERY other org's repos (and
  // their latest scan) into Node uncapped — a cross-tenant memory blow-up that grows with the whole
  // corpus, not this tenant. Bound it to the most-recently-active CORPUS_CAP scored repos (`updatedAt`
  // bumps on every scan upsert) and require `scans: { some: {} }` so the cap budget isn't spent on
  // never-scanned repos the loop below discards anyway. A representative recent sample, not the universe.
  // Both the `some` predicate and the per-repo `take: 1` are filtered by BENCHMARK_ELIGIBLE, so the cap
  // budget is spent on comparable repos and each repo contributes its latest ELIGIBLE scan rather than
  // its latest scan (a repo whose most recent run degraded to mock still counts, via its last real one).
  // TENANCY (G4-02): the corpus is OTHER tenants' data, so it is restricted to `isPrivate: false`.
  // Without it, another org's PRIVATE repo scores fed corpusAvg*/the percentile that this org reads
  // back on /portfolio, in the digest and in the Executive Briefing PDF — a cross-tenant leak of
  // exactly the repos a tenant marked as not-for-sharing (aggregated, but still derived from them,
  // and observable: a small corpus moves measurably when one private repo enters it). Public repos
  // are already world-readable, so they are the only defensible corpus. This org's OWN side (the
  // `mine` query below) is deliberately unfiltered — an org is always entitled to its own repos.
  const repos = await prisma.repository.findMany({
    where: { orgId: { not: org.id }, isPrivate: false, scans: { some: BENCHMARK_ELIGIBLE } },
    orderBy: { updatedAt: "desc" },
    take: BENCHMARK_CORPUS_CAP,
    select: {
      orgId: true,
      primaryLanguage: true,
      scans: {
        where: BENCHMARK_ELIGIBLE,
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { overallScore: true, adoptionScore: true, rigorScore: true },
      },
    },
  });
  const corpus: { orgId: string; lang: string | null; overall: number; adoption: number; rigor: number }[] = [];
  for (const r of repos) {
    const s = r.scans[0];
    if (s) corpus.push({ orgId: r.orgId, lang: r.primaryLanguage, overall: s.overallScore, adoption: s.adoptionScore, rigor: s.rigorScore });
  }
  const corpusAvgOverall = roundedMean(corpus.map((c) => c.overall));
  const corpusAvgAdoption = roundedMean(corpus.map((c) => c.adoption));
  const corpusAvgRigor = roundedMean(corpus.map((c) => c.rigor));
  // `corpus.length === 0` ⇔ all three corpus means are null. Written as the null check because it is
  // the SAME guard, and writing it this way narrows the three means for the return below instead of
  // leaving a `!` (or a second `?? 0`) at the point of use. The zeros here are not means: they ride
  // out beside `corpusRepos: 0`, which is the field that says there was no corpus at all.
  if (corpusAvgOverall === null || corpusAvgAdoption === null || corpusAvgRigor === null) {
    return { corpusRepos: 0, corpusBasis: CORPUS_BASIS, overallPercentile: null, corpusAvgOverall: 0, corpusAvgAdoption: 0, corpusAvgRigor: 0, cohort: null };
  }

  // This org's averages + dominant language (latest scan per repo).
  const mine = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: {
      primaryLanguage: true,
      scans: {
        where: BENCHMARK_ELIGIBLE, // same instrument on both sides, or the comparison means nothing
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { overallScore: true, adoptionScore: true },
      },
    },
  });
  const myOverall: number[] = [];
  const myAdoption: number[] = [];
  const langCounts = new Map<string, number>();
  for (const r of mine) {
    const s = r.scans[0];
    if (!s) continue;
    myOverall.push(s.overallScore);
    myAdoption.push(s.adoptionScore);
    if (r.primaryLanguage) langCounts.set(r.primaryLanguage, (langCounts.get(r.primaryLanguage) ?? 0) + 1);
  }

  const avg = roundedMean;
  const myAvgOverall = mean(myOverall);
  const myAvgAdoption = mean(myAdoption);

  // Per-ORG means over a corpus slice — so the org's mean is ranked against OTHER ORGS' means
  // (population-vs-population), not against a per-repo distribution. Bug-fix (fleet-rollups-insights
  // #2): a mean of N repos is far less variable than individual repos, so percentile-ing one
  // aggregated number inside an un-aggregated repo distribution biased every org toward the middle
  // (a unit mismatch: scalar-vs-population). Now both the org and its peers are summarized the same way.
  const orgMeans = (rows: typeof corpus, pick: (c: (typeof corpus)[number]) => number): number[] => {
    const byOrg = new Map<string, { sum: number; n: number }>();
    for (const c of rows) {
      const e = byOrg.get(c.orgId) ?? { sum: 0, n: 0 };
      e.sum += pick(c);
      e.n += 1;
      byOrg.set(c.orgId, e);
    }
    return [...byOrg.values()].map((e) => e.sum / e.n);
  };

  // Peer cohort = corpus repos in the org's dominant language.
  const domLang = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let cohort: OrgBenchmark["cohort"] = null;
  if (domLang) {
    const peers = corpus.filter((c) => c.lang === domLang);
    const peerAvgOverall = avg(peers.map((p) => p.overall));
    // `peers.length > 0` ⇔ `peerAvgOverall !== null` — the same guard, written as the null check so
    // the cohort's `avgOverall` is narrowed by it. No same-language peer means no cohort, which is
    // what `cohort: null` already said.
    if (peerAvgOverall !== null) {
      // Rank this org's mean against peer ORG means within the language (not peer repos).
      const peerOrgOverall = orgMeans(peers, (p) => p.overall);
      const peerOrgAdoption = orgMeans(peers, (p) => p.adoption);
      cohort = {
        language: domLang,
        repos: peers.length,
        overallPercentile: percentileOf(peerOrgOverall, myAvgOverall, COHORT_MIN),
        adoptionPercentile: percentileOf(peerOrgAdoption, myAvgAdoption, COHORT_MIN),
        avgOverall: peerAvgOverall,
      };
    }
  }

  return {
    corpusRepos: corpus.length,
    corpusBasis: CORPUS_BASIS,
    // Org mean vs other orgs' means (CORPUS_MIN is now a floor on the number of peer ORGS, not repos).
    overallPercentile: percentileOf(orgMeans(corpus, (c) => c.overall), myAvgOverall, CORPUS_MIN),
    corpusAvgOverall,
    corpusAvgAdoption,
    corpusAvgRigor,
    cohort,
  };
}
