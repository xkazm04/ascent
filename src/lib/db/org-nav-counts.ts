// Nav badge counts — the "how many items here await a decision" number the org rail prints on a
// module. This runs in the org SHELL, so it wraps EVERY dashboard tab and its cost is paid on every
// view: three indexed aggregates in one round-trip, no per-page fan-out (the same discipline
// getOrgHeaderSummary keeps, and the reason this doesn't just call getOrgBacklog/listOpsState).
//
// Only modules with a PERSISTED status column are counted. A badge is a promise that the number goes
// down when you act on it, so a derived count with no resolve/dismiss affordance (security findings,
// unowned repos, passport blockers, solo-maintainer risk) is deliberately absent rather than shown as
// a number that can never clear. Those modules earn a badge when their follow-ups become decision
// items with real state.
//
// Recommendation rows accumulate across re-scans (they carry forward matched by dimId+title), so a
// flat `recommendation.count()` would count every historical scan and disagree with what /backlog
// lists. The count is scoped to each repo's LATEST scan — the same "take: 1, orderBy scannedAt desc"
// window getOrgBacklog reads — selecting only ids so the payload stays tiny.

import { cache } from "react";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { applyPassportOverrides, parsePassportJson, parsePassportOverrides } from "@/lib/analyze/passport";

/** Unresolved counts keyed by the org route segment the badge belongs to. */
export interface OrgNavCounts {
  /** Follow-ups (recommendations) still open or handed off on each repo's latest scan — the
   *  Follow-ups ledger's badge. (The Plan tab's initiatives count retired with the tab, 2026-08-17.) */
  followups: number;
  /** Invites still pending and not yet expired. */
  members: number;
}

/** The two statuses that mean "still awaiting a human" — shared by Recommendation and Initiative. */
const UNRESOLVED = ["open", "in_progress"];

/**
 * Memoized per request (React `cache()`), so the shell's call and a page's own call collapse into one
 * round-trip. Returns null when the DB is off or the org is unknown — the rail then renders bare, which
 * is the correct degradation: no badge is a weaker claim than a zero badge.
 */
export const getOrgNavCounts = cache(async (orgSlug: string): Promise<OrgNavCounts | null> => {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const [repos, members] = await Promise.all([
    prisma.repository.findMany({
      where: { orgId: org.id },
      select: {
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 1,
          select: { recommendations: { where: { status: { in: UNRESOLVED } }, select: { id: true } } },
        },
      },
    }),
    prisma.invite.count({ where: { orgId: org.id, status: "pending", expiresAt: { gt: new Date() } } }),
  ]);

  const followups = repos.reduce((n, r) => n + (r.scans[0]?.recommendations.length ?? 0), 0);
  return { followups, members };
});

/** One repo's readiness blockers, override-applied — the only rollup field the passports badge reads. */
export interface OrgPassportBlockers {
  fullName: string;
  /** Both readiness axes concatenated; `passportFindings` de-dupes the overlap. */
  blockers: string[];
}

/**
 * The passport blockers behind the `passports` nav badge, as ONE narrow query.
 *
 * The badge's derivation (lib/org/nav-counts.ts `deriveFindings`) used to call the full unscoped
 * `getOrgRollup` and then throw away everything but `repos[].passport.*.blockers`. That rollup is the
 * dashboard's heaviest read — every repo's latest scan WITH its dimension rows, plus governance /
 * techStack / passport JSON parsing, plus TWO unbounded `scan.findMany` sweeps (the daily trend and
 * the baseline/cohort snapshot). None of that is reachable from a blocker list. And because the badge
 * renders in the org SHELL, that cost was charged to EVERY tab — including Audit, which reads nothing
 * else from the fleet. (The 60s `unstable_cache` capped the frequency; it never made the query cheap.)
 *
 * The passport blob lives on `Repository`, not on `Scan`, so the blockers need no scan join at all —
 * three columns over the same repo set the rollup uses (watched OR has-scans), which is what keeps the
 * badge number byte-identical: same repos, same `applyPassportOverrides` composition, same axes.
 *
 * React-`cache()`d for the request like its sibling above; the cross-request `unstable_cache` stays
 * where it was, around the finding derivation.
 */
export const getOrgPassportBlockers = cache(async (orgSlug: string): Promise<OrgPassportBlockers[]> => {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];

  const repos = await prisma.repository.findMany({
    // Mirrors getOrgRollup's repo set exactly — a repo the rollup would have excluded must not start
    // contributing findings just because this path got cheaper.
    where: { orgId: org.id, OR: [{ watched: true }, { scans: { some: {} } }] },
    select: { fullName: true, passportJson: true, passportOverridesJson: true },
    orderBy: { fullName: "asc" },
  });

  const out: OrgPassportBlockers[] = [];
  for (const r of repos) {
    const parsed = parsePassportJson(r.passportJson);
    if (!parsed) continue; // no passport → the rollup's `.filter(r => r.passport)` dropped it too
    const p = applyPassportOverrides(parsed, parsePassportOverrides(r.passportOverridesJson));
    out.push({
      fullName: r.fullName,
      blockers: [...p.automationReadiness.blockers, ...p.productionReadiness.blockers],
    });
  }
  return out;
});
