// The adopted product KPIs, computed from the data ascent already stores. One function per KPI, each
// returning a single number plus the raw numerator/denominator that produced it — a bare percentage
// with no counts behind it is unauditable, and every one of these has a cohort definition worth
// checking.
//
// Written for the Personas KPI set adopted 2026-07-30. The KPI rows carry a `measure_config` that
// assumes PostHog/Sentry; ascent has neither, and seven of the eight are plain queries over this
// database instead. This module is that measurement path.
//
// Every function returns null when persistence is off, matching the rest of src/lib/db. A null means
// "not measurable", which is a different claim from 0 and must never be rendered as one.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { estimateLlmCostFromTable, type ModelTokenUsage } from "@/lib/db/usage";
import { APPROACHING, AT_RISK, classifyOutputBudget, type BudgetLevel } from "@/lib/llm/output-budget";

/** A ratio KPI: the value plus the counts it came from, so a reader can audit the cohort. */
export interface RatioMetric {
  /** The KPI value in its declared unit (% for the rate metrics). */
  value: number;
  numerator: number;
  denominator: number;
}

const DAY_MS = 86_400_000;
const ago = (days: number): Date => new Date(Date.now() - days * DAY_MS);

/**
 * Rows a KPI reads per page when its cohort is a table that grows without bound.
 *
 * GET /api/kpi runs every metric in this module CONCURRENTLY (Promise.all), so a reader that
 * materializes its whole table decides the memory ceiling of the operator endpoint - and does it at
 * the moment the fleet is finally large enough for the numbers to matter. Each paged reader below
 * keeps only counters between pages, so its footprint is a page, not a history. Mirrors
 * REPO_PAGE_SIZE in db/retention.ts, which pages the repo enumeration for the same reason.
 */
const KPI_PAGE_SIZE = 500;

/** Cursor-page arguments, or nothing on the first page. */
const page = (cursor: string | undefined): { cursor?: { id: string }; skip?: number } =>
  cursor ? { cursor: { id: cursor }, skip: 1 } : {};

/** A rate over a cohort. A zero denominator yields null, not 0% — "no one has signed up yet" and
 *  "everyone who signed up failed to activate" are opposite facts and must not share a rendering. */
function rate(numerator: number, denominator: number): RatioMetric | null {
  if (denominator <= 0) return null;
  return { value: (numerator / denominator) * 100, numerator, denominator };
}

// ── KPI: first-scan activation rate (target 60%) ──────────────────────────────

/**
 * Share of users who reached a scored report within `windowDays` of signing up.
 *
 * Cohort caveat worth knowing before you quote this: a Scan belongs to a Repository, which belongs to
 * an Organization — never to a User. So activation is credited through membership, and in a
 * multi-member org one person's scan activates every colleague who joined before it. On the personal
 * tier (Organization.kind = "personal") the attribution is exact. Signups still inside the window are
 * excluded from the denominator rather than counted as failures.
 */
export async function firstScanActivationRate(windowDays = 7): Promise<RatioMetric | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const windowMs = windowDays * DAY_MS;
  let cohort = 0;
  let activated = 0;
  let cursor: string | undefined;

  for (;;) {
    // Ordered by SIGNUP TIME, and that is what makes the single scan read below possible: a page is
    // contiguous in createdAt, so one bounded window covers every user in it. (Was: one
    // scan.findFirst per user - N+1 round trips against DSQL, on an endpoint that runs nine metrics
    // at once.)
    const users = await prisma.user.findMany({
      where: { createdAt: { lt: ago(windowDays) } },
      select: { id: true, createdAt: true, memberships: { select: { orgId: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: KPI_PAGE_SIZE,
      ...page(cursor),
    });
    if (users.length === 0) break;
    cohort += users.length;

    const orgIds = [...new Set(users.flatMap((u) => u.memberships.map((m) => m.orgId)))];
    if (orgIds.length > 0) {
      const scans = await prisma.scan.findMany({
        where: {
          scannedAt: {
            gte: users[0]!.createdAt,
            lte: new Date(users[users.length - 1]!.createdAt.getTime() + windowMs),
          },
          repo: { orgId: { in: orgIds } },
        },
        select: { scannedAt: true, repo: { select: { orgId: true } } },
      });
      const byOrg = new Map<string, number[]>();
      for (const s of scans) {
        const at = s.scannedAt.getTime();
        const seen = byOrg.get(s.repo.orgId);
        if (seen) seen.push(at);
        else byOrg.set(s.repo.orgId, [at]);
      }
      for (const u of users) {
        const from = u.createdAt.getTime();
        const to = from + windowMs;
        // A membership-less user cannot activate and stays in the denominator - the same reading as
        // before: they signed up and never reached a scored report.
        const hit = u.memberships.some((m) =>
          (byOrg.get(m.orgId) ?? []).some((at) => at >= from && at <= to),
        );
        if (hit) activated++;
      }
    }

    if (users.length < KPI_PAGE_SIZE) break;
    cursor = users[users.length - 1]!.id;
  }
  return rate(activated, cohort);
}

// ── KPI: 30-day re-scan rate (target 35%) ─────────────────────────────────────

/**
 * Share of repos whose second scan landed within `windowDays` of their first. The product's core
 * act-then-remeasure loop, and the cleanest measurement in the set: it needs only the Scan table, and
 * the (repoId, scannedAt) index already serves the ordering.
 *
 * Repos whose first scan is still inside the window are excluded — they have not yet had the chance to
 * re-scan, and counting them would drag the rate down with recent-signup volume.
 */
export async function reScanRate(windowDays = 30): Promise<RatioMetric | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const cutoff = ago(windowDays);
  const windowMs = windowDays * DAY_MS;
  let eligible = 0;
  let reScanned = 0;
  let cursor: string | undefined;

  // Walk REPOS, not scans. The metric only ever needed each repo's first two scans, but it read the
  // entire Scan table - every row, all time - to find them, and built two Maps over the lot. Paging
  // the repo list and asking for those two rows per repo keeps the working set to a page.
  for (;;) {
    const repos = await prisma.repository.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: KPI_PAGE_SIZE,
      ...page(cursor),
    });
    if (repos.length === 0) break;
    const repoIds = repos.map((r) => r.id);

    // `distinct` with an orderBy led by repoId yields the EARLIEST scan per repo. A repo with no scan
    // simply does not appear, which is how it stays out of the denominator (as before).
    const firsts = await prisma.scan.findMany({
      where: { repoId: { in: repoIds } },
      select: { id: true, repoId: true, scannedAt: true },
      orderBy: [{ repoId: "asc" }, { scannedAt: "asc" }, { id: "asc" }],
      distinct: ["repoId"],
    });
    // The second scan is the earliest one that is not the first - expressible because the query above
    // returned ids. The exclusion list is bounded by the page, never by history.
    const firstIds = firsts.map((f) => f.id);
    const seconds = firstIds.length
      ? await prisma.scan.findMany({
          where: { repoId: { in: repoIds }, id: { notIn: firstIds } },
          select: { repoId: true, scannedAt: true },
          orderBy: [{ repoId: "asc" }, { scannedAt: "asc" }, { id: "asc" }],
          distinct: ["repoId"],
        })
      : [];
    const secondAt = new Map(seconds.map((s) => [s.repoId, s.scannedAt.getTime()]));

    for (const f of firsts) {
      if (f.scannedAt > cutoff) continue; // window has not closed for this repo yet
      eligible++;
      const at = secondAt.get(f.repoId);
      if (at !== undefined && at - f.scannedAt.getTime() <= windowMs) reScanned++;
    }

    if (repos.length < KPI_PAGE_SIZE) break;
    cursor = repos[repos.length - 1]!.id;
  }
  return rate(reScanned, eligible);
}

// ── KPI: free-to-paid conversion (target 6%) ──────────────────────────────────

/**
 * Share of orgs that completed a scan on the free tier and took a subscription within `windowDays`.
 *
 * Reads the local Subscription row rather than the billing provider: an org that upgraded and later
 * cancelled still converted, and Subscription.createdAt preserves that where a current-status check
 * would erase it. The denominator is orgs that actually reached a scan — an org that signed up and
 * never scanned never saw the value being priced, so including it measures the funnel, not the offer.
 */
export async function freeToPaidConversion(windowDays = 30): Promise<RatioMetric | null> {
  if (!isDbConfigured()) return null;
  const orgs = await getPrisma().organization.findMany({
    select: {
      id: true,
      subscription: { select: { createdAt: true } },
      repositories: {
        select: { scans: { select: { scannedAt: true }, orderBy: { scannedAt: "asc" }, take: 1 } },
      },
    },
  });

  let eligible = 0;
  let converted = 0;
  for (const o of orgs) {
    const firsts = o.repositories.flatMap((r) => r.scans.map((s) => s.scannedAt));
    if (firsts.length === 0) continue;
    const firstScan = new Date(Math.min(...firsts.map((d) => d.getTime())));
    if (firstScan > ago(windowDays)) continue; // window still open
    eligible++;
    const sub = o.subscription?.createdAt;
    if (sub && sub.getTime() - firstScan.getTime() <= windowDays * DAY_MS) converted++;
  }
  return rate(converted, eligible);
}

// ── KPI: org fleet scan depth (target 45%) ────────────────────────────────────

/**
 * Share of GitHub-App-installed orgs that have scanned at least `minRepos` distinct repositories.
 * Separates a trial (one repo, once) from adoption (a fleet) — and a shallow fleet means the org
 * dashboard and rollups the Team tier is sold on are effectively invisible to that customer.
 */
export async function orgFleetScanDepth(minRepos = 3): Promise<RatioMetric | null> {
  if (!isDbConfigured()) return null;
  const orgs = await getPrisma().organization.findMany({
    where: { githubInstallId: { not: null } },
    select: { repositories: { select: { _count: { select: { scans: true } } } } },
  });
  if (orgs.length === 0) return null;
  const deep = orgs.filter(
    (o) => o.repositories.filter((r) => r._count.scans > 0).length >= minRepos,
  ).length;
  return rate(deep, orgs.length);
}

// ── KPI: roadmap engagement rate (target 40%) ─────────────────────────────────

/**
 * Share of scans whose report had at least one recommendation moved off its initial status within
 * `windowDays` of delivery. This is the product's outcome promise — a report nobody acts on is a
 * mirror, not a change engine — and RecommendationEvent(kind="status") records exactly that
 * transition, so it needs no new instrumentation.
 */
export async function roadmapEngagementRate(windowDays = 14): Promise<RatioMetric | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const windowMs = windowDays * DAY_MS;
  let delivered = 0;
  let engaged = 0;
  let cursor: string | undefined;

  // `scannedAt < ago(windowDays)` is ALL HISTORY minus the last fortnight, and the old read pulled it
  // in one query with `recommendations.events` joined underneath - every recommendation and every
  // status event ever recorded, materialized to compute two counters. Paged, the counters are all
  // that survives a page.
  for (;;) {
    const scans = await prisma.scan.findMany({
      where: { scannedAt: { lt: ago(windowDays) } },
      select: { id: true, scannedAt: true },
      orderBy: [{ scannedAt: "asc" }, { id: "asc" }],
      take: KPI_PAGE_SIZE,
      ...page(cursor),
    });
    if (scans.length === 0) break;
    delivered += scans.length;

    const events = await prisma.recommendationEvent.findMany({
      where: { kind: "status", recommendation: { scanId: { in: scans.map((s) => s.id) } } },
      select: { createdAt: true, recommendation: { select: { scanId: true } } },
    });
    const byScan = new Map<string, number[]>();
    for (const e of events) {
      const at = e.createdAt.getTime();
      const seen = byScan.get(e.recommendation.scanId);
      if (seen) seen.push(at);
      else byScan.set(e.recommendation.scanId, [at]);
    }
    for (const s of scans) {
      const at = s.scannedAt.getTime();
      if ((byScan.get(s.id) ?? []).some((e) => e - at <= windowMs)) engaged++;
    }

    if (scans.length < KPI_PAGE_SIZE) break;
    cursor = scans[scans.length - 1]!.id;
  }
  return rate(engaged, delivered);
}

// ── KPI: weekly active scanning orgs (target 30) ──────────────────────────────

/** Distinct orgs that initiated at least one scan in the trailing `windowDays`. The weekly heartbeat:
 *  one number that folds activation, retention and fleet growth together. A count, not a rate. */
export async function weeklyActiveScanningOrgs(windowDays = 7): Promise<number | null> {
  if (!isDbConfigured()) return null;
  const rows = await getPrisma().scan.findMany({
    where: { scannedAt: { gte: ago(windowDays) } },
    select: { repo: { select: { orgId: true } } },
  });
  return new Set(rows.map((r) => r.repo.orgId)).size;
}

// ── KPI: average LLM cost per completed scan (target $0.25) ───────────────────

export interface ScanCostMetric {
  /** Mean USD per priced scan. */
  value: number;
  /** Scans that carried token counts and a priceable model. */
  pricedScans: number;
  /** Scans excluded because their model has no entry in MODEL_PRICES — see the null contract below. */
  unpricedScans: number;
}

/**
 * Mean LLM spend per completed scan over the trailing `windowDays`. The LLM is ~100% of scan COGS, so
 * this is the unit economics of every metered scan and every unlimited-plan seat.
 *
 * Token counts and the model are already persisted on each Scan row, so nothing new is needed. Cost
 * folding reuses estimateLlmCostFromTable rather than reimplementing the price table — it refuses to
 * price a model it does not know, and that refusal is honored here per-scan: an unpriceable scan is
 * excluded and counted in `unpricedScans` rather than silently entering the mean at zero, which would
 * pull average cost DOWN exactly when an unrecognised (often newer, pricier) model appears.
 *
 * Mock scans carry no tokens and are excluded — they have no COGS and would otherwise dilute the mean.
 */
export async function avgLlmCostPerScan(windowDays = 30): Promise<ScanCostMetric | null> {
  if (!isDbConfigured()) return null;
  const scans = await getPrisma().scan.findMany({
    where: { scannedAt: { gte: ago(windowDays) } },
    select: { engineProvider: true, engineModel: true, inputTokens: true, outputTokens: true },
  });

  let total = 0;
  let priced = 0;
  let unpriced = 0;
  for (const s of scans) {
    const inputTokens = s.inputTokens ?? 0;
    const outputTokens = s.outputTokens ?? 0;
    if (inputTokens + outputTokens === 0) continue; // mock / token-less — skip BEFORE building `usage`
    const usage: ModelTokenUsage[] = [
      // `provider` carried through so a local ($0) engine prices as zero rather than falling into the
      // `unpriced` bucket — otherwise a self-hosted fleet would look like a fleet Ascent can't cost.
      { model: s.engineModel, provider: s.engineProvider, inputTokens, outputTokens },
    ];
    const cost = estimateLlmCostFromTable(usage);
    if (cost === null) {
      unpriced++;
      continue;
    }
    total += cost;
    priced++;
  }
  if (priced === 0) return null;
  return { value: total / priced, pricedScans: priced, unpricedScans: unpriced };
}

// ── KPI: average LLM cost per ACTIVE org, across every lane (#11) ─────────────

export interface OrgCostMetric {
  /** Mean USD per active org over the window, across every inference lane. */
  value: number;
  /** Orgs that consumed inference in the window — the denominator. */
  activeOrgs: number;
  /** Calls whose cost could not be established and are therefore NOT in the numerator. */
  unpricedCalls: number;
}

/**
 * Mean LLM spend per ACTIVE ORG over the trailing window, across every lane — scans plus Athena, org
 * memory, the briefing narrative and the local agent.
 *
 * Why this exists beside `avgLlmCostPerScan`: that metric answers "what does a scan cost", which was
 * the whole COGS question while scanning was the only thing the product spent money on. It is not any
 * more. A companion that answers questions all day costs real money against the same subscription and
 * appears in no per-scan figure at all, so a fleet could be priced on a scan number while its actual
 * bill per tenant moved somewhere else entirely. This is the per-tenant number a packaging decision
 * needs.
 *
 * HONEST DENOMINATOR: an org is "active" if it consumed inference in the window, in ANY lane. HONEST
 * NUMERATOR: an unpriceable call is excluded and counted in `unpricedCalls` rather than entering the
 * mean at zero — which would pull the average DOWN exactly when an unrecognised (often newer, pricier)
 * model appears. Null when nothing was active: not measurable, which is not $0.
 */
export async function avgLlmCostPerActiveOrg(windowDays = 30): Promise<OrgCostMetric | null> {
  if (!isDbConfigured()) return null;
  const since = ago(windowDays);
  const prisma = getPrisma();
  const [scans, eventGroups, unpricedGroups] = await Promise.all([
    prisma.scan.findMany({
      where: { scannedAt: { gte: since } },
      select: {
        engineProvider: true,
        engineModel: true,
        inputTokens: true,
        outputTokens: true,
        repo: { select: { orgId: true } },
      },
    }),
    // The other lanes are already priced at write time (costMicros), so they fold by summation.
    prisma.usageEvent.groupBy({ by: ["orgId"], where: { createdAt: { gte: since } }, _sum: { costMicros: true } }),
    prisma.usageEvent.groupBy({
      by: ["orgId"],
      where: { createdAt: { gte: since }, costMicros: null },
      _count: true,
    }),
  ]);

  const orgs = new Set<string>();
  let total = 0;
  let unpriced = 0;
  for (const s of scans) {
    orgs.add(s.repo.orgId);
    const inputTokens = s.inputTokens ?? 0;
    const outputTokens = s.outputTokens ?? 0;
    if (inputTokens + outputTokens === 0) continue; // mock / token-less — no COGS to fold
    const usage: ModelTokenUsage[] = [
      { model: s.engineModel, provider: s.engineProvider, inputTokens, outputTokens },
    ];
    const cost = estimateLlmCostFromTable(usage);
    if (cost === null) {
      unpriced++;
      continue;
    }
    total += cost;
  }
  for (const g of eventGroups) {
    orgs.add(g.orgId);
    total += (g._sum.costMicros ?? 0) / 1_000_000;
  }
  for (const g of unpricedGroups) unpriced += g._count;

  if (orgs.size === 0) return null;
  return { value: total / orgs.size, activeOrgs: orgs.size, unpricedCalls: unpriced };
}

// ── KPI: scan pipeline error rate (target 3%) ─────────────────────────────────

export interface ScanErrorRateMetric extends RatioMetric {
  /** User-side outcomes subtracted from the denominator (bad URL, private repo, disconnect). */
  rejected: number;
  /** Scans that silently fell back to the mock floor — a report without the model. Not an error by
   *  this KPI's definition (they did not terminate), but the number to watch beside it. */
  degraded: number;
}

/**
 * Share of attempted scans that died in the pipeline. Reads the counters emitted by
 * src/lib/scan-outcome.ts, because the Scan table holds successes only.
 *
 * Returns null when no scan has been attempted since the counters shipped — which is the honest
 * answer, and specifically not 0%. These are all-time tallies (QuotaEvent is a running total, not a
 * time series), so this is a lifetime rate; a windowed version needs a real event table.
 */
export async function scanPipelineErrorRate(): Promise<ScanErrorRateMetric | null> {
  if (!isDbConfigured()) return null;
  const rows = await getPrisma().quotaEvent.findMany({
    where: { kind: { in: ["scan_started", "scan_rejected", "scan_failed", "scan_degraded"] } },
    select: { kind: true, count: true },
  });
  const sum = (kind: string): number =>
    rows.filter((r) => r.kind === kind).reduce((a, r) => a + r.count, 0);

  const started = sum("scan_started");
  const rejected = sum("scan_rejected");
  const failed = sum("scan_failed");
  const attempted = started - rejected;
  if (attempted <= 0) return null;
  return {
    value: (failed / attempted) * 100,
    numerator: failed,
    denominator: attempted,
    rejected,
    degraded: sum("scan_degraded"),
  };
}

/**
 * THE GOD-SCAN TREND: how close the single-call assessment is running to the model's output ceiling,
 * fleet-wide, over a window.
 *
 * `classifyOutputBudget` warns on ONE scan. This is the other half: the question that actually
 * triggers a design change is not "was this scan near the limit" but "are our scans TRENDING toward
 * it", and that only shows up across many scans. When p95 crosses the approaching band the answer is
 * not a bigger model, it is to split the assessment into per-dimension calls.
 *
 * p95, not the mean: the mean is dominated by small repos and stays reassuring long after the largest
 * repos have started truncating. The scans that hit the ceiling are exactly the tail.
 *
 * Null when no scan in the window reported usage (a mock-only or keyless deployment). Null is "not
 * measured", never "comfortably small".
 */
export interface OutputBudgetMetric {
  scans: number;
  medianOutputTokens: number;
  p95OutputTokens: number;
  /** p95 as a share of each scan's own model ceiling, so mixed-engine fleets stay comparable. */
  p95PctOfCap: number;
  worst: { model: string; outputTokens: number; pctOfCap: number } | null;
  level: BudgetLevel;
}

export async function scanOutputBudget(windowDays = 30): Promise<OutputBudgetMetric | null> {
  if (!isDbConfigured()) return null;
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await getPrisma().scan.findMany({
    where: { scannedAt: { gte: since }, outputTokens: { gt: 0 } },
    select: { engineModel: true, outputTokens: true },
  });
  if (rows.length === 0) return null;

  const graded = rows
    .map((r) => {
      const b = classifyOutputBudget(r.outputTokens, r.engineModel);
      return b ? { model: r.engineModel, outputTokens: b.outputTokens, pctOfCap: b.usedPct } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  if (graded.length === 0) return null;

  const byTokens = [...graded].sort((a, b) => a.outputTokens - b.outputTokens);
  const byPct = [...graded].sort((a, b) => a.pctOfCap - b.pctOfCap);
  const at = <T,>(xs: T[], q: number): T => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;

  const p95Pct = at(byPct, 0.95).pctOfCap;
  return {
    scans: graded.length,
    medianOutputTokens: at(byTokens, 0.5).outputTokens,
    p95OutputTokens: at(byTokens, 0.95).outputTokens,
    p95PctOfCap: p95Pct,
    worst: byPct[byPct.length - 1] ?? null,
    level: p95Pct >= AT_RISK * 100 ? "at-risk" : p95Pct >= APPROACHING * 100 ? "approaching" : "ok",
  };
}
