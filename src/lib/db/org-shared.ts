// Shared internals for the org-rollup family (org-*.ts). Private to the db layer — re-exported
// through org.ts only where part of the public surface; the helpers here are not. All guarded by
// DATABASE_URL at the call sites.

import { cache } from "react";
import { getPrisma } from "@/lib/db/client";

/**
 * Resolve an org by slug, memoized per server request via React `cache()`. A single dashboard render
 * fans out many fleet aggregates (rollup, movers, recommendations, benchmark, gaps, goals, …) and each
 * one used to re-issue the IDENTICAL `organization.findUnique({ where: { slug } })` — ~8–10 redundant
 * round-trips per page. Routing them all through this collapses them to one lookup per request (the
 * same per-request memo pattern getViewer uses in lib/access). Returns the full row — callers read
 * `id` and `plan` — or null when the org doesn't exist. Callers still guard isDbConfigured() first.
 *
 * Canonicalizes the slug (trim + lowercase) before the lookup: org rows are PERSISTED lower-cased (the
 * GitHub-App install flow lowercases), and this is the single resolver the whole rollup family funnels
 * through, yet most callers passed the raw slug. A mixed-case URL (`/org/MyOrg`) then passed auth (which
 * resolves via getOrgId → already normalized) but returned null/empty from every aggregate. Normalizing
 * here makes this the one canonicalization point for the family, so auth and data agree on identity.
 */
export const getOrgBySlug = cache((slug: string) => {
  return getPrisma().organization.findUnique({ where: { slug: slug.trim().toLowerCase() } });
});

export const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
export const IMPACT_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Canonicalize an org slug for a lookup: trim + lower-case. Org rows are PERSISTED lower-cased (the
 * GitHub-App install flow writes `opts.login.toLowerCase()`) and the auth layer (canReadOrg / getOrgId)
 * normalizes before authorizing, so every data-layer `findUnique({ where: { slug } })` must normalize
 * too — otherwise an authorized mixed-case login (e.g. `/org/PostHog`) misses the canonical `posthog`
 * row and the aggregate silently returns an empty "no data" dashboard. The single source for this
 * normalization across the whole org-rollup family, so the unnormalized-slug class can't recur.
 */
export function normalizeOrgSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/**
 * Repo-level where-fragment that scopes an aggregate to a custom segment (a user-defined tag on
 * repos — see src/lib/db/segments.ts). Empty when no segment is selected, so every aggregate stays
 * fleet-wide by default. AND-combines with the existing `orgId` filter, so a segment id from another
 * org matches no repos rather than leaking across tenants.
 */
export function segmentScope(segmentId?: string | null) {
  return segmentId ? { segments: { some: { segmentId } } } : {};
}

/**
 * Repo-level where-fragment that scopes an aggregate to an auto-derived tech-stack group (Feature 3b —
 * frontend / backend:<lang> / mobile / …). Empty when no group is selected (fleet-wide default).
 * AND-combines with `orgId` and composes with segmentScope (segment AND stack). Keyed on the group's
 * globally-unique id (the page resolves the `?stack=` key → id against the org's own groups), so a group
 * id from another org matches no repos rather than leaking across tenants — exactly like segmentScope.
 */
export function techGroupScope(groupId?: string | null) {
  return groupId ? { techGroups: { some: { groupId } } } : {};
}

// All derived from the stored RepoContributor snapshots (latest scan per repo) — no extra
// GitHub calls. "commits"/"aiCommits" reflect the recent-activity window we capture at scan
// time. Bots ([bot]) and unattributed ("unknown") commits are excluded from the human view.
export const isBot = (login: string) => /\[bot\]$/i.test(login) || login === "unknown";

/** Arithmetic mean of a number list; 0 for an empty list (never divides by zero). */
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** {@link mean}, rounded to the nearest integer. The canonical rounded-average for the org rollups
 *  — always empty-guarded, so copies that omitted the guard are corrected by routing through here. */
export function roundedMean(xs: number[]): number {
  return Math.round(mean(xs));
}

/** Share (0..100) of a person's commits that are AI-attributed; 0 when they have no commits.
 *  Single source for the "AI champion" share formula used by both contributor and team rollups. */
export function aiShareOf(commits: number, aiCommits: number): number {
  return commits ? Math.round((aiCommits / commits) * 100) : 0;
}

/**
 * Select the top-N "champions" from a human-only contributor list: keep those passing `filter`, sort by
 * the `by` metric descending, and take the first `limit`. The shared select-shape behind both
 * `getContributorInsights` (ranked by championScore, sliced 6, requires ≥3 commits) and `rollupTeams`
 * (ranked by aiCommits, sliced 3); each caller supplies its own filter/metric/limit. Does not mutate
 * the input (sorts a copy).
 */
export function pickChampions<T>(people: T[], opts: { filter: (p: T) => boolean; by: (p: T) => number; limit: number }): T[] {
  return people
    .filter(opts.filter)
    .sort((a, b) => opts.by(b) - opts.by(a))
    .slice(0, opts.limit);
}
