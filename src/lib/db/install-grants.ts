// Auto-watch for repos NEWLY GRANTED on a GitHub App installation (backlog develop-2026-09-17 row 35).
//
// The user adds `acme/billing` on GitHub's "Only select repositories" page; `installation_repositories`
// fires; the webhook re-lists the installation from GitHub. Before this module the reconcile only
// dropped watch for repos that LEFT the set, so the grant the user had just made started nothing. Now a
// repo in that live set is watched when ALL of these hold:
//
//   1. The listing is GitHub's own and COMPLETE. The caller passes the `listInstallationReposResult`
//      repos and never calls this on a `truncated` listing; the payload's `repositories_added` is never
//      read (a signed delivery proves authenticity, not freshness or ownership).
//   2. The org already runs a non-empty watchlist. An org that never watched anything has not opted into
//      a fleet, and a grant is not that opt-in.
//   3. The org has NO Repository row for the name. Rows are never deleted in this tree, and a stored
//      `watched: false` carries no author: a person's explicit unwatch (setRepoWatch false), a scanned
//      but never-watched repo and a repo the reconcile unwatched all look the same. Row presence is the
//      only signal that cannot re-watch a repo a person turned off, so an existing row is never touched.
//   4. At most GRANT_AUTO_WATCH_CAP names per org per event, so a "selected -> all" flip cannot turn
//      into a fleet-wide scan storm. The rest stay unwatched and have no row written, so a later grant
//      event can pick them up (up to the cap again); they are logged and audited, never dropped silently.
//
// Watching goes through the import path (setRepoWatch + setRepoSchedule at the import's default
// cadence) via the single `watchGrantedRepo`, which is the hook a later hosted watch-scope rule can
// guard. Nothing here reserves a credit: the scan worker reserves when the scheduled scan runs.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { setRepoSchedule, setRepoWatch } from "@/lib/db/org-watch";
import { recordOrgAudit } from "@/lib/db/scans-audit";

/** Most newly granted repos one installation event may auto-watch per org. */
export const GRANT_AUTO_WATCH_CAP = 20;
/** The import route's default cadence (POST /api/org/import `schedule ?? "weekly"`). */
export const GRANT_AUTO_WATCH_SCHEDULE = "weekly";
export const AUTO_WATCH_ACTION = "org.repos.auto_watched";
/** Overflow names kept in a log line / audit row; the COUNT is always exact. */
const OVERFLOW_SAMPLE = 50;

/** The slice of an `AppRepo` (the installation listing) this module needs. */
export interface GrantedRepo {
  fullName: string;
  owner: string;
  name: string;
  url?: string;
  private?: boolean;
}

export interface OrgGrantPlan {
  orgSlug: string;
  watch: GrantedRepo[];
  overflow: string[];
}

export interface OrgGrantResult {
  orgSlug: string;
  watched: string[];
  failed: string[];
  overflow: string[];
}

/** Pure: the live names the org has never recorded, deduplicated, in stable name order, split at `cap`. */
export function selectNewlyGranted(
  live: readonly GrantedRepo[],
  knownLower: ReadonlySet<string>,
  cap: number = GRANT_AUTO_WATCH_CAP,
): { watch: GrantedRepo[]; overflow: string[] } {
  const seen = new Set<string>();
  const fresh: GrantedRepo[] = [];
  for (const r of live) {
    const key = r.fullName.toLowerCase();
    if (knownLower.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push(r);
  }
  fresh.sort((a, b) => (a.fullName.toLowerCase() < b.fullName.toLowerCase() ? -1 : 1));
  return { watch: fresh.slice(0, cap), overflow: fresh.slice(cap).map((r) => r.fullName) };
}

/**
 * Read-only half: which orgs bound to this installation get which newly granted repos. Call it BEFORE
 * the destructive reconcile, so the "non-empty watchlist" test sees the org as it was when the user
 * made the change (an `{a} -> {b}` swap would otherwise read as an empty watchlist). Personal
 * workspaces are excluded, as the fleet watch route excludes them.
 */
export async function planGrantedAutoWatch(
  installationId: number | string,
  live: readonly GrantedRepo[],
): Promise<OrgGrantPlan[]> {
  if (!isDbConfigured() || live.length === 0) return [];
  const prisma = getPrisma();
  const orgs = await prisma.organization.findMany({
    where: { githubInstallId: String(installationId), kind: { not: "personal" } },
    select: { id: true, slug: true },
  });
  const plans: OrgGrantPlan[] = [];
  for (const org of orgs) {
    const watchedCount = await prisma.repository.count({ where: { orgId: org.id, watched: true } });
    if (watchedCount === 0) continue;
    // EVERY row, watched or not: see rule 3 in the header.
    const rows = await prisma.repository.findMany({ where: { orgId: org.id }, select: { fullName: true } });
    const known = new Set(rows.map((r) => r.fullName.toLowerCase()));
    const { watch, overflow } = selectNewlyGranted(live, known);
    if (watch.length > 0 || overflow.length > 0) plans.push({ orgSlug: org.slug, watch, overflow });
  }
  return plans;
}

/** The ONE write path for an install-granted watch: the import route's watch + cadence pair. */
export async function watchGrantedRepo(orgSlug: string, r: GrantedRepo): Promise<void> {
  await setRepoWatch(orgSlug, { owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, isPrivate: r.private }, true);
  await setRepoSchedule(orgSlug, r.fullName, GRANT_AUTO_WATCH_SCHEDULE);
}

/** Write half: watch each planned repo (one failure does not stop the rest), then log + audit the event. */
export async function applyGrantedAutoWatch(
  installationId: number | string,
  plans: readonly OrgGrantPlan[],
): Promise<OrgGrantResult[]> {
  const results: OrgGrantResult[] = [];
  for (const plan of plans) {
    const watched: string[] = [];
    const failed: string[] = [];
    for (const r of plan.watch) {
      try {
        await watchGrantedRepo(plan.orgSlug, r);
        watched.push(r.fullName);
      } catch (err) {
        failed.push(r.fullName);
        console.warn(
          `[install-grants] ${plan.orgSlug}: could not auto-watch ${r.fullName}`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (plan.overflow.length > 0) {
      console.warn(
        `[install-grants] installation ${installationId} (${plan.orgSlug}): watched ${watched.length}, ${plan.overflow.length} more newly granted repo(s) left unwatched past the ${GRANT_AUTO_WATCH_CAP}-per-event cap: ${plan.overflow.slice(0, OVERFLOW_SAMPLE).join(", ")}`,
      );
    }
    await recordOrgAudit(AUTO_WATCH_ACTION, plan.orgSlug, {
      installationId: Number(installationId),
      watched,
      failed,
      cap: GRANT_AUTO_WATCH_CAP,
      overflowCount: plan.overflow.length,
      overflow: plan.overflow.slice(0, OVERFLOW_SAMPLE),
    });
    results.push({ orgSlug: plan.orgSlug, watched, failed, overflow: plan.overflow });
  }
  return results;
}
