// Shared internals for the org-rollup family (org-*.ts). Private to the db layer — re-exported
// through org.ts only where part of the public surface; the helpers here are not. All guarded by
// DATABASE_URL at the call sites.

export const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
export const IMPACT_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Repo-level where-fragment that scopes an aggregate to a custom segment (a user-defined tag on
 * repos — see src/lib/db/segments.ts). Empty when no segment is selected, so every aggregate stays
 * fleet-wide by default. AND-combines with the existing `orgId` filter, so a segment id from another
 * org matches no repos rather than leaking across tenants.
 */
export function segmentScope(segmentId?: string | null) {
  return segmentId ? { segments: { some: { segmentId } } } : {};
}

// All derived from the stored RepoContributor snapshots (latest scan per repo) — no extra
// GitHub calls. "commits"/"aiCommits" reflect the recent-activity window we capture at scan
// time. Bots ([bot]) and unattributed ("unknown") commits are excluded from the human view.
export const isBot = (login: string) => /\[bot\]$/i.test(login) || login === "unknown";
