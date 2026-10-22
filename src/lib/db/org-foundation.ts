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
//   • `reportBackAt: null` means the repo CANNOT report: never provisioned, revoked, a failed write, or a
//     credential retired since. It is not "off". `reportBack.state` says which.
//   • `foundationPrAt: null` means no install PR was ever opened through Ascent. A repo whose team
//     hand-committed `.ai/` is therefore null here, which is true of what ASCENT knows.
//
// Timestamps are ISO STRINGS, never `Date`: this row type is imported by a client component, and
// `NextResponse.json`/the RSC boundary turn a Date into a string at runtime while the type would still
// promise `.getTime()`. The `.toISOString()` mapping happens here, server-side.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import {
  canReport,
  provisionRecordOf,
  reportBackState,
  type ProvisionRecord,
  type ReportBackStatus,
} from "@/lib/github/reportback-credential";
import { appConfigureUrl } from "@/lib/ui";

/** One repo's rollout standing. Every timestamp is an ISO string — see the header. */
export interface FoundationRolloutRow {
  /** "owner/name". */
  repo: string;
  /** When Ascent last opened/updated the foundation PR here. Null = never installed through Ascent. */
  foundationPrAt: string | null;
  /** When report-back was provisioned, set only while the repo CAN report (live or legacy-shared). */
  reportBackAt: string | null;
  /**
   * The credential's real state: the latest provision row's `ok` joined with whether the token it
   * recorded is still live. Optional on the type so hand-built fixtures stay valid; readers fall back
   * to `reportBackAt` (see reportBackOf in the foundation feature).
   */
  reportBack?: ReportBackStatus;
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

function parseMeta(meta: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(meta) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
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

  const [repos, events, liveTokens] = await Promise.all([
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
    // Display prefixes only: enough to tell a live credential from a retired one, useless as a bearer.
    prisma.orgApiToken.findMany({ where: { orgId, revokedAt: null }, select: { tokenPrefix: true } }),
  ]);
  if (repos.length === 0) return [];

  // First sighting wins (the list is newest-first), so each map holds the LATEST event of its kind.
  const installedAt = new Map<string, Date>();
  const provisionedAt = new Map<string, Date>();
  const revokedAt = new Map<string, Date>();
  const provisionRecord = new Map<string, ProvisionRecord>();
  for (const e of events) {
    const meta = parseMeta(e.meta);
    const repo = typeof meta?.repo === "string" ? meta.repo.toLowerCase() : null;
    if (!meta || !repo) continue;
    if (e.action === "foundation.reportback_provisioned" && !provisionRecord.has(repo)) {
      provisionRecord.set(repo, provisionRecordOf(meta));
    }
    const target =
      e.action === "foundation.pr_opened"
        ? installedAt
        : e.action === "foundation.reportback_provisioned"
          ? provisionedAt
          : revokedAt;
    if (!target.has(repo)) target.set(repo, e.at);
  }

  const livePrefixes = new Set(liveTokens.map((t) => t.tokenPrefix));
  // The Configure page is only worth a lookup when some row needs it (a missing-permission failure).
  let configureUrl: string | null | undefined;
  const configureFor = async () => {
    if (configureUrl === undefined) {
      const id = await getInstallationIdForOwner(orgSlug).catch(() => null);
      configureUrl = id ? appConfigureUrl(id) : null;
    }
    return configureUrl;
  };

  const rows: FoundationRolloutRow[] = [];
  for (const r of repos) {
    const key = r.fullName.toLowerCase();
    const provisioned = provisionedAt.get(key) ?? null;
    const revoked = revokedAt.get(key) ?? null;
    // A revoke that is NEWER than the provision means report-back is gone. A revoke that is OLDER means
    // it was torn down and set up again, so the current state is the latest provision's.
    const current = provisioned && (!revoked || revoked <= provisioned) ? provisioned : null;
    const reportBack = reportBackState(current ? (provisionRecord.get(key) ?? null) : null, livePrefixes);
    if (reportBack.reason === "missing-permission") {
      const url = await configureFor();
      if (url) reportBack.configureUrl = url;
    }
    rows.push({
      repo: r.fullName,
      foundationPrAt: installedAt.get(key)?.toISOString() ?? null,
      reportBackAt: current && canReport(reportBack) ? current.toISOString() : null,
      reportBack,
      // `?? null` and NOT `?? 0`: absence is absence.
      conformance: typeof r.aiConformance === "number" ? r.aiConformance : null,
      conformanceAt: r.aiConformanceAt ? r.aiConformanceAt.toISOString() : null,
    });
  }
  return rows;
}
