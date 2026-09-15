// Weekly follow-up activity for one org: what CLOSED inside the window, and what OPENED inside it.
//
// The two halves are measured by DIFFERENT mechanisms, and that asymmetry is the whole reason this
// module exists rather than one symmetric query:
//
//   CLOSED is an EVENT. `RecommendationEvent{kind:"status", toValue:"done"}` is written in the same
//   transaction as the mutation that caused it (see updateRecommendation), so "closed this week" is a
//   fact with a timestamp. `dismissed` is counted BESIDE it, never folded in — a dismissal is a
//   decision not to do the work, and reporting it as a closure would let a fleet "improve" by
//   declining its own backlog.
//
//   OPENED is a DERIVED DIFF, because no open-event exists. Recommendation rows are RECREATED on
//   every scan (scans-persist.ts ~524: `recommendations: { create: … }`, with status carried across by
//   the `(dimId, title)` identity), so `Recommendation.createdAt` is the SCAN's date, not the date the
//   gap appeared. Counting `createdAt` inside the window would report every gap on every rescanned
//   repository as "opened this week". Instead a gap is opened when its `dimId::title` identity is
//   present in a repository's LATEST scan and ABSENT from that repository's latest scan strictly
//   BEFORE the window start.
//
//   That diff is UNMEASURABLE for a repository with no pre-window scan — there is nothing to compare
//   against, and treating "no baseline" as "empty baseline" would report a newly-onboarded
//   repository's entire backlog as this week's regression. Such repositories are excluded and
//   COUNTED (`unmeasuredRepos`) so the exclusion is visible; when NO repository has a baseline the
//   function returns null and the digest prints "not measurable" rather than a fabricated zero.
//
// Window closure is inherited, not re-derived: the event query spreads `dateRange(start, window,
// "createdAt")` — the same helper `getOrgRecsActioned` uses — so the half-open `[start, endExclusive)`
// policy holds here by construction rather than by a hand-written `lte` that would double-count a
// boundary row against the adjacent week.
//
// Query shape: the "latest scan per repository" picks are `groupBy … _max` + an exact-pair `findMany`,
// NEVER a nested `take: 1`. Read the header of org-insights.ts (getOrgBacklog) for the measurement
// behind that rule — under this engine a nested take is applied client-side, so the org's whole scan
// history crosses the wire.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { dateRange } from "@/lib/db/org-shared";
import { getOrgId, type OrgWindow } from "@/lib/db/org-rollup";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
import type { DigestFollowupRow } from "@/lib/org/digest-types";

/** Only these two statuses are outstanding work; `done`/`dismissed` are settled. */
const OUTSTANDING = ["open", "in_progress"];

/** Stable identity of a recommendation ACROSS scans — the same key scans-persist carries status by. */
const identity = (r: { dimId: string; title: string }) => `${r.dimId}::${r.title}`;

const dimLabel = (dimId: string): string => DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId;

export interface ClosedInWindow {
  /** Status events reaching `done` inside the window. */
  closed: number;
  /** Status events reaching `dismissed` inside the window — reported beside `closed`, never inside it. */
  dismissed: number;
  /** The newest `limit` closures, newest first. */
  rows: DigestFollowupRow[];
}

export interface OpenedInWindow {
  opened: number;
  rows: DigestFollowupRow[];
  /** Repositories excluded from the diff because they had no scan before the window start. */
  unmeasuredRepos: number;
}

/**
 * Follow-ups CLOSED (and, separately, dismissed) inside the window.
 *
 * Scoped org → repo → scan → recommendation, exactly like `getOrgRecsActioned`, and restricted to
 * `kind: "gap"`: a craft entry is what would make an already-strong dimension exemplary, never a
 * follow-up the team owed, so closing one is not debt paid down (r10).
 *
 * Returns zeros — not null — when the DB is unconfigured or the org is unknown: a digest section that
 * says "0 closed" for an org with no database is wrong but bounded, whereas the caller needs closed
 * and dismissed to be numbers to print a line at all. The opened half, whose zero WOULD be a lie,
 * returns null instead (see below).
 */
export async function getFollowupsClosedInWindow(
  orgSlug: string,
  window: OrgWindow,
  limit = 5,
): Promise<ClosedInWindow> {
  const empty: ClosedInWindow = { closed: 0, dismissed: 0, rows: [] };
  if (!isDbConfigured()) return empty;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return empty;

  // `dateRange(start, window, "createdAt")` — the half-open policy is INHERITED from the shared
  // helper (`lt: endExclusive`), not restated here, so this read cannot drift from the rollup's.
  const scope = {
    kind: "status",
    ...dateRange(window.start ?? null, window, "createdAt"),
    recommendation: { kind: "gap", scan: { repo: { orgId } } },
  };

  const [closed, dismissed, rows] = await Promise.all([
    prisma.recommendationEvent.count({ where: { ...scope, toValue: "done" } }),
    prisma.recommendationEvent.count({ where: { ...scope, toValue: "dismissed" } }),
    prisma.recommendationEvent.findMany({
      where: { ...scope, toValue: "done" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        // `actor` is the GitHub login who made the change and is NULL for a system write — which is
        // exactly what the rescan resolver does when it auto-closes a gap it can no longer detect. So
        // "who closed it" is readable without a second column: a login means a person, null means the
        // scan noticed. Nothing else writes these rows.
        actor: true,
        createdAt: true,
        recommendation: {
          select: {
            title: true,
            dimId: true,
            scan: { select: { repo: { select: { fullName: true } } } },
          },
        },
      },
    }),
  ]);

  return {
    closed,
    dismissed,
    rows: rows.map((e) => ({
      title: e.recommendation?.title ?? "",
      dimId: e.recommendation?.dimId ?? "",
      dimLabel: dimLabel(e.recommendation?.dimId ?? ""),
      repo: e.recommendation?.scan?.repo?.fullName ?? "",
      at: e.createdAt.toISOString(),
      how: e.actor ? "human" : "scan",
    })),
  };
}

/**
 * Follow-ups OPENED inside the window, as an identity diff between each repository's latest scan and
 * its latest scan strictly before `window.start`.
 *
 * Null means UNMEASURABLE, and is not the same fact as `{ opened: 0 }`:
 *   - no `window.start` (an all-time window has no "before"),
 *   - the DB is unconfigured or the org is unknown,
 *   - no repository in the org has any scan predating the window.
 * The digest renders that as an explicit "not measurable" line rather than as a clean week.
 */
export async function getFollowupsOpenedInWindow(
  orgSlug: string,
  window: OrgWindow,
  limit = 5,
): Promise<OpenedInWindow | null> {
  const start = window.start ?? null;
  if (!start) return null;
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;

  const repoScope = { orgId };
  // Two real SQL GROUP BYs, in parallel: the latest scan per repository (unbounded — "as things
  // stand"), and the latest scan per repository strictly before the window start (the baseline). The
  // baseline bound is `lt: start`, matching the rollup/movers cohort, so a scan landing exactly on the
  // boundary belongs to the window and not to the thing the window is compared against.
  const [latestAgg, baselineAgg] = await Promise.all([
    prisma.scan.groupBy({ by: ["repoId"], where: { repo: repoScope }, _max: { scannedAt: true } }),
    prisma.scan.groupBy({ by: ["repoId"], where: { repo: repoScope, scannedAt: { lt: start } }, _max: { scannedAt: true } }),
  ]);

  const pairs = (agg: { repoId: string; _max: { scannedAt: Date | null } }[]) =>
    agg
      .filter((a): a is typeof a & { _max: { scannedAt: Date } } => a._max.scannedAt != null)
      .map((a) => ({ repoId: a.repoId, scannedAt: a._max.scannedAt }));

  const latestPairs = pairs(latestAgg);
  const baselinePairs = pairs(baselineAgg);
  const baselineRepoIds = new Set(baselinePairs.map((p) => p.repoId));
  // A repository is measurable only if it sits on BOTH sides. Everything else is counted, not dropped
  // silently — an org halfway through onboarding must be able to see how much of the fleet the diff
  // could not speak for.
  const measurable = latestPairs.filter((p) => baselineRepoIds.has(p.repoId));
  const unmeasuredRepos = latestPairs.length - measurable.length;
  if (measurable.length === 0) return null;

  // Resolve the chosen (repoId, scannedAt) pairs to the scan rows. Two scans of one repo can share a
  // timestamp (a seeded fixture, a same-instant backfill), so the pick is deduped in code — exactly
  // what the forbidden nested `take: 1` would have guaranteed.
  const [latestScans, baselineScans] = await Promise.all([
    prisma.scan.findMany({ where: { OR: measurable }, select: { id: true, repoId: true, repo: { select: { fullName: true } } } }),
    prisma.scan.findMany({ where: { OR: baselinePairs }, select: { id: true, repoId: true } }),
  ]);

  const latestByRepo = new Map<string, { id: string; repoId: string; repo: { fullName: string } | null }>();
  for (const s of latestScans) if (!latestByRepo.has(s.repoId)) latestByRepo.set(s.repoId, s);
  const baselineByRepo = new Map<string, { id: string; repoId: string }>();
  for (const s of baselineScans) if (!baselineByRepo.has(s.repoId)) baselineByRepo.set(s.repoId, s);

  const latestIds = [...latestByRepo.values()].map((s) => s.id);
  const baselineIds = [...baselineByRepo.values()].filter((s) => latestByRepo.has(s.repoId)).map((s) => s.id);
  if (latestIds.length === 0 || baselineIds.length === 0) return null;

  const [nowRecs, baseRecs] = await Promise.all([
    // Present-day OUTSTANDING gaps. A gap already closed by the time we look is not "opened this week"
    // even if it appeared and was fixed inside it — the closed half already reports that event.
    prisma.recommendation.findMany({
      where: { scanId: { in: latestIds }, kind: "gap", status: { in: OUTSTANDING } },
      orderBy: { createdAt: "asc" },
      select: { scanId: true, title: true, dimId: true },
    }),
    // The baseline is read WITHOUT a status filter on purpose: an identity that existed before the
    // window — in any state — is a carried-forward gap, not a new one.
    prisma.recommendation.findMany({
      where: { scanId: { in: baselineIds }, kind: "gap" },
      select: { scanId: true, title: true, dimId: true },
    }),
  ]);

  const repoOfScan = new Map<string, string>();
  for (const s of latestByRepo.values()) repoOfScan.set(s.id, s.repoId);
  for (const s of baselineByRepo.values()) repoOfScan.set(s.id, s.repoId);

  // Seeded with an EMPTY set per measurable repository, not built lazily from the baseline rows. A
  // repository whose pre-window scan found no gaps is measurable and its baseline is genuinely empty —
  // every gap on it today is new. Building the map only from rows that exist would leave that repo
  // with no entry, indistinguishable from "no baseline", and its whole backlog would silently vanish
  // from the diff instead of being reported as this week's regression.
  const baselineIdentities = new Map<string, Set<string>>();
  for (const p of measurable) baselineIdentities.set(p.repoId, new Set<string>());
  for (const r of baseRecs) {
    const repoId = repoOfScan.get(r.scanId);
    if (!repoId) continue;
    baselineIdentities.get(repoId)?.add(identity(r));
  }

  const rows: DigestFollowupRow[] = [];
  let opened = 0;
  for (const r of nowRecs) {
    const repoId = repoOfScan.get(r.scanId);
    if (!repoId) continue;
    const before = baselineIdentities.get(repoId);
    if (!before) continue; // measurable set only — defensive, the query already restricts it
    if (before.has(identity(r))) continue; // carried forward, not opened
    opened += 1;
    if (rows.length < limit) {
      rows.push({
        title: r.title,
        dimId: r.dimId,
        dimLabel: dimLabel(r.dimId),
        repo: latestByRepo.get(repoId)?.repo?.fullName ?? "",
        // An opened row has no event behind it — the diff derived it. Saying "null" is the honest
        // shape; inventing the scan's timestamp would present a derivation as an observation.
        at: null,
        how: null,
      });
    }
  }

  return { opened, rows, unmeasuredRepos };
}

/** Scans that finished inside the window, org-scoped. The digest's coverage denominator for the week. */
export async function countScansInWindow(orgSlug: string, window: OrgWindow): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return 0;
  return prisma.scan.count({
    where: { repo: { orgId }, ...dateRange(window.start ?? null, window) },
  });
}
