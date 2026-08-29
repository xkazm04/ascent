// Fleet foundation rollout — READ-ONLY, and deliberately schema-free.
//
// "Which repos have the `.ai/` foundation, which report their conformance back, and what did they
// last report?" is answerable from data the app already writes: the audit ledger holds one
// `foundation.pr_opened` row per install (batch and single-repo installs write the SAME action, so the
// two doors are indistinguishable here — that is the point) plus the provision/revoke pair, and the
// `Repository` row already carries the conformance score `/api/report/conformance` records. So this
// module adds no table and no column; it JOINS what exists.
//
// HONEST NULLS are the whole contract of the row type below and are restated in the panel's legend:
//   • `conformance: null` means NEVER REPORTED. It is not 0 — a repo that has never run the doctor and
//     a repo that scored 0% are opposite facts, and collapsing them would invent a basis (G4).
//   • `reportBackAt: null` means NOT PROVISIONED (or provisioned and later revoked). It is not "off".
//   • `foundationPrAt: null` means no install PR was ever opened through Ascent. A repo whose team
//     hand-committed `.ai/` is therefore null here, which is true of what ASCENT knows.
//
// Timestamps are ISO STRINGS, never `Date`: this row type is imported by a client component, and
// `NextResponse.json`/the RSC boundary turn a Date into a string at runtime while the type would still
// promise `.getTime()`. The `.toISOString()` mapping happens here, server-side.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

/** One repo's rollout standing. Every timestamp is an ISO string — see the header. */
export interface FoundationRolloutRow {
  /** "owner/name". */
  repo: string;
  /** When Ascent last opened/updated the foundation PR here. Null = never installed through Ascent. */
  foundationPrAt: string | null;
  /** When report-back was provisioned. Null once revoked — and null is "not provisioned", not "off". */
  reportBackAt: string | null;
  /** Latest reported conformance %, or null for NEVER REPORTED. Never 0-as-unknown. */
  conformance: number | null;
  conformanceAt: string | null;
}

/** The three audit actions this read is derived from. */
const ROLLOUT_ACTIONS = [
  "foundation.pr_opened",
  "foundation.reportback_provisioned",
  "foundation.reportback_revoked",
] as const;

function metaRepo(meta: string): string | null {
  try {
    const parsed = JSON.parse(meta) as Record<string, unknown>;
    return typeof parsed.repo === "string" ? parsed.repo.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The org's foundation rollout, one row per tracked repo, newest-first by repo name.
 *
 * Returns [] (not null) when the DB is off or the org is unknown: the panel renders "nothing yet",
 * which is the truthful reading of "we have no data", and chrome must never 500 a page.
 *
 * Cost note: two queries — the org's repos, and the org's rollout audit rows — folded in memory. The
 * audit read is bounded (`take`), because a long-lived org's ledger is unbounded while only the LATEST
 * event per repo per action can change a row. Rows are ordered newest-first, so the first sighting of a
 * (repo, action) pair IS the latest one.
 */
export async function getFoundationRollout(orgSlug: string): Promise<FoundationRolloutRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return [];
  const prisma = getPrisma();

  const [repos, events] = await Promise.all([
    prisma.repository.findMany({
      where: { orgId },
      select: { fullName: true, aiConformance: true, aiConformanceAt: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { orgId, action: { in: [...ROLLOUT_ACTIONS] } },
      select: { action: true, meta: true, at: true },
      orderBy: [{ at: "desc" }],
      take: 2000,
    }),
  ]);
  if (repos.length === 0) return [];

  // First sighting wins (the list is newest-first), so each map holds the LATEST event of its kind.
  const installedAt = new Map<string, Date>();
  const provisionedAt = new Map<string, Date>();
  const revokedAt = new Map<string, Date>();
  for (const e of events) {
    const repo = metaRepo(e.meta);
    if (!repo) continue;
    const target =
      e.action === "foundation.pr_opened"
        ? installedAt
        : e.action === "foundation.reportback_provisioned"
          ? provisionedAt
          : revokedAt;
    if (!target.has(repo)) target.set(repo, e.at);
  }

  return repos.map((r) => {
    const key = r.fullName.toLowerCase();
    const provisioned = provisionedAt.get(key) ?? null;
    const revoked = revokedAt.get(key) ?? null;
    // A revoke that is NEWER than the provision means report-back is gone. A revoke that is OLDER means
    // it was torn down and set up again — the current state is provisioned.
    const live = provisioned && (!revoked || revoked <= provisioned) ? provisioned : null;
    return {
      repo: r.fullName,
      foundationPrAt: installedAt.get(key)?.toISOString() ?? null,
      reportBackAt: live ? live.toISOString() : null,
      // `?? null` and NOT `?? 0`: absence is absence.
      conformance: typeof r.aiConformance === "number" ? r.aiConformance : null,
      conformanceAt: r.aiConformanceAt ? r.aiConformanceAt.toISOString() : null,
    };
  });
}
