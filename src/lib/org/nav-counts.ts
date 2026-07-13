// The org rail's badge counts, in one place.
//
// Two very different kinds of number meet here:
//
//   1. STATEFUL modules (backlog · plan · members) own a status column, so their count is three
//      indexed aggregates — see src/lib/db/org-nav-counts.ts.
//   2. PROMOTED modules (security · teams · passports · contributors) surface findings DERIVED from
//      scan data. They own no row, so the count is "every derived finding, minus the ones a human has
//      already resolved" (OrgDecision). That derivation is the expensive half.
//
// This module lives in lib/org rather than lib/db on purpose: deriving findings needs
// buildSecurityOverview, which already imports the db layer. Composing here keeps the dependency
// pointing one way (org → db) instead of introducing a db → org → db cycle.
//
// COST — this is the whole reason the file is shaped the way it is. The shell wraps every dashboard
// tab, so deriving findings naively taxed EVERY view: /audit, which reads nothing but its own log,
// went from 144ms to 1.5s once four fleet rollups ran in its shell.
//
// The fix rests on the two halves changing at completely different rates. FINDINGS only change when a
// scan runs (minutes to days), so they are cached across requests with `unstable_cache`. DECISIONS
// change the instant a user clicks Accept, so they are read fresh on every request and subtracted from
// the cached findings. That means a decision is reflected immediately — no cache to invalidate, no
// revalidateTag on the write path — while the expensive derivation is paid once a minute per org.
//
// `deriveFindings` is what gets cached, and it is deliberately NOT React-`cache()`d itself: that memo
// is request-scoped, and scans-read.ts already documents that `unstable_cache` must not enclose
// request-scoped reads. The React `cache()` sits OUTSIDE, on `getOrgFindings`, so a page that renders
// the same findings it badges (the security register, the teams tab) collapses to one call per request.

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getContributorInsights, getOrgRollup, getOrgTeamRollup, resolvedKeys } from "@/lib/db";
import { getOrgNavCounts, type OrgNavCounts } from "@/lib/db";
import { buildSecurityOverview } from "@/lib/org/security";
import {
  contributorFindings,
  passportFindings,
  securityFindings,
  teamsFindings,
  type Finding,
} from "@/lib/org/findings";

/** Findings move only on a scan, so a minute of staleness on a badge is invisible and cheap. */
const FINDINGS_TTL_SECONDS = 60;

/** Unresolved counts keyed by the org route segment the badge belongs to. */
export type NavCounts = OrgNavCounts & {
  security: number;
  teams: number;
  passports: number;
  contributors: number;
};

/**
 * Every decidable finding across the promoted modules. Each source is independently `.catch`ed to
 * null: a badge is chrome, and one module's derivation failing must not blank the other three (nor
 * 500 the shell).
 */
async function deriveFindings(orgSlug: string): Promise<Finding[]> {
  const [security, rollup, teams, contributors] = await Promise.all([
    buildSecurityOverview(orgSlug).catch(() => null),
    getOrgRollup(orgSlug).catch(() => null),
    getOrgTeamRollup(orgSlug).catch(() => null),
    getContributorInsights(orgSlug).catch(() => null),
  ]);

  const passportRepos = (rollup?.repos ?? [])
    .filter((r) => r.passport)
    .map((r) => ({
      fullName: r.fullName,
      // A blocker can sit on either readiness axis; passportFindings de-dupes the overlap.
      blockers: [...r.passport!.automationReadiness.blockers, ...r.passport!.productionReadiness.blockers],
    }));

  return [
    ...securityFindings(security?.register ?? []),
    ...teamsFindings(teams?.unowned ?? []),
    ...passportFindings(passportRepos),
    ...contributorFindings(
      (contributors?.concentration ?? []).map((c) => ({
        fullName: c.fullName,
        soloMaintainer: c.soloMaintainer,
        contributors: c.contributorCount,
        topShare: c.topShare,
      })),
    ),
  ];
}

/**
 * Cached across requests (findings move only on a scan), then memoized per request so the shell's
 * badge and the page's own render share one call. The cache key includes the slug — a per-org cached
 * function, built per call, is the sanctioned way to pass a dynamic key to `unstable_cache`.
 */
export const getOrgFindings = cache((orgSlug: string): Promise<Finding[]> =>
  unstable_cache(() => deriveFindings(orgSlug), ["org-findings", orgSlug], {
    revalidate: FINDINGS_TTL_SECONDS,
    tags: [`org-findings:${orgSlug}`],
  })(),
);

/** Findings a human hasn't yet resolved, grouped by module — the badge numbers. */
export const getOrgFindingCounts = cache(async (orgSlug: string) => {
  const [findings, resolved] = await Promise.all([
    getOrgFindings(orgSlug),
    resolvedKeys(orgSlug).catch(() => new Map<string, Set<string>>()),
  ]);
  const counts = { security: 0, teams: 0, passports: 0, contributors: 0 };
  for (const f of findings) {
    if (resolved.get(f.module)?.has(f.itemKey)) continue;
    counts[f.module] += 1;
  }
  return counts;
});

/** The full badge set the shell hands to OrgNav. Null only when the DB is off / the org is unknown. */
export async function getNavCounts(orgSlug: string): Promise<NavCounts | null> {
  const [stateful, derived] = await Promise.all([
    getOrgNavCounts(orgSlug),
    getOrgFindingCounts(orgSlug).catch(() => ({ security: 0, teams: 0, passports: 0, contributors: 0 })),
  ]);
  if (!stateful) return null;
  return { ...stateful, ...derived };
}
