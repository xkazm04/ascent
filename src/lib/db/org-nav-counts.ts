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

/** Unresolved counts keyed by the org route segment the badge belongs to. */
export interface OrgNavCounts {
  /** Recommendations still open or in progress on each repo's latest scan. */
  backlog: number;
  /** Initiatives still open or in progress. */
  plan: number;
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

  const [repos, plan, members] = await Promise.all([
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
    prisma.initiative.count({ where: { orgId: org.id, status: { in: UNRESOLVED } } }),
    prisma.invite.count({ where: { orgId: org.id, status: "pending", expiresAt: { gt: new Date() } } }),
  ]);

  const backlog = repos.reduce((n, r) => n + (r.scans[0]?.recommendations.length ?? 0), 0);
  return { backlog, plan, members };
});
