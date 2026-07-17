// Persistence for GitHub App installations. An installation maps a GitHub account
// (org/user login) to an installation_id; we store it on Organization.githubInstallId,
// using the login (lowercased) as the org slug so a repo owner resolves to its install.
//
// IDENTITY DECISION (github-app-installation-webhooks 07-16 #2): `installation.id` is the STABLE key;
// the GitHub login (== our org slug) is MUTABLE display + routing. GitHub orgs can rename (acme →
// acme-inc) while keeping the same installation, so `upsertInstallation` reconciles by install id
// BEFORE writing by slug: a row already holding this installation under a different slug is MIGRATED
// (slug renamed in place — watch flags, schedules, and every repo/report FK ride along via orgId), so
// pushes under the new login keep matching the watched repos instead of silently forking history
// across two tenant rows. When the new slug is ALREADY an existing org (rare: it was seen via a public
// scan first), the installation is moved to that row and detached from the stale one — the install id
// points at exactly one org — with a loud log, since the stale row's watch/history do not migrate.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { bumpSessionVersion } from "@/lib/db/sessions";
import { invalidateInstallationToken } from "@/lib/github/app";

export async function upsertInstallation(opts: {
  login: string;
  installationId: number | string;
}): Promise<void> {
  if (!isDbConfigured()) return;
  const slug = opts.login.toLowerCase();
  const installId = String(opts.installationId);
  // Plan policy (github-app-installation-webhooks #1): installing the App is NOT an entitlement
  // grant — billing (Polar; see POLAR_PLAN_PRODUCTS / src/lib/db/org.ts) is the sole plan
  // authority. New rows get the canonical platform default ("free", the schema default; matches
  // members.ts's owner-seed path), and `update` deliberately omits `plan` so an installation event
  // can never upgrade OR downgrade an existing org. Historical rows may still carry the legacy
  // "private" string this path used to mint — planFeatures() resolves any non-PlanId (incl.
  // "private") to the free tier, so those rows are feature-equivalent to "free".
  const update = { githubInstallId: installId, name: opts.login };
  const prisma = getPrisma();

  // Rename / transfer reconciliation (see the file-header IDENTITY DECISION): does another org row
  // already hold this installation under a DIFFERENT slug? That is a GitHub org rename (or an
  // installation transfer) — the login moved but the installation did not. Without this, the upsert
  // below forks the tenant: a fresh row under the new slug with no watched repos, while the stale slug
  // keeps the schedules and silently stops matching incoming webhooks.
  const existing = await prisma.organization.findFirst({
    where: { githubInstallId: installId, NOT: { slug } },
    select: { id: true, slug: true },
  });
  if (existing) {
    const target = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!target) {
      // Clean rename: migrate the row to the new slug. orgId-keyed children (repos, watch flags,
      // schedules, reports) follow automatically; sessions/routes under the old slug stop resolving,
      // which mirrors GitHub itself (the old login 404s after a rename).
      try {
        await prisma.organization.update({
          where: { id: existing.id },
          data: { slug, name: opts.login, githubInstallId: installId },
        });
        console.warn(
          `[installations] GitHub rename detected for installation ${installId}: migrated org slug "${existing.slug}" -> "${slug}"`,
        );
        return;
      } catch (err) {
        // A concurrent writer created the new slug between our lookup and the rename — fall through to
        // the transfer path semantics via the upsert below after detaching the stale row.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    }
    // The new slug already exists as its own org (or won a race above): move the installation to the
    // row matching the CURRENT login and detach the stale one so owner→install resolution follows
    // GitHub. Loud log — the stale row's watch flags/history do NOT migrate in this shape.
    await prisma.organization.update({ where: { id: existing.id }, data: { githubInstallId: null } });
    console.warn(
      `[installations] installation ${installId} moved from org "${existing.slug}" to existing org "${slug}" — ` +
        `watched repos/schedules on "${existing.slug}" were not migrated and its autoscans will stop`,
    );
  }

  try {
    await prisma.organization.upsert({
      where: { slug },
      update,
      create: { slug, name: opts.login, plan: "free", githubInstallId: installId },
    });
  } catch (err) {
    // The setup callback (GET /api/app/setup) and the installation webhook can upsert the same
    // slug near-simultaneously. Prisma's upsert isn't atomic across its find/create, so both
    // can miss the row and race to INSERT — the loser throws P2002 on the unique slug even
    // though the install did persist. Converge idempotently by applying our update to the row
    // that won, instead of bubbling a spurious failure (which made /api/app/setup misreport
    // setup_failed).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await prisma.organization.update({ where: { slug }, data: update });
      return;
    }
    throw err;
  }
}

export async function removeInstallation(installationId: number | string): Promise<void> {
  // Drop any cached installation token immediately (in-memory, independent of the DB): a cached
  // token can outlive the installation's access, and a deleted-then-reissued installation reusing
  // the same id must not be served the stale token. Run this before the DB guard so it fires even
  // on a DB-less deployment (the App can be configured without a database).
  invalidateInstallationToken(installationId);
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const installId = String(installationId);

  // Identify the org(s) this installation backs before we detach the id, so we can quiesce
  // their autoscans in the same pass.
  const orgs = await prisma.organization.findMany({
    where: { githubInstallId: installId },
    select: { id: true, slug: true },
  });

  // Once the App is uninstalled/suspended we can no longer mint installation tokens for these
  // (often private) repos, so any scheduled rescan would fail forever and burn API calls. Clear
  // the watch flag and pause schedules so listDueRescans stops returning them. A reinstall
  // re-lists repos on demand and the user can re-select what to watch.
  if (orgs.length) {
    await prisma.repository.updateMany({
      where: { orgId: { in: orgs.map((o) => o.id) } },
      data: { watched: false, scanSchedule: "off", nextScanAt: null },
    });
  }

  await prisma.organization.updateMany({
    where: { githubInstallId: installId },
    data: { githubInstallId: null },
  });

  // Reflect the access change in live sessions: bump the session version for each affected
  // login so a still-valid cookie is revoked on its next resolve rather than lingering until
  // its TTL. The org slug is the owner login (lowercased) — for a personal-account
  // installation that is the user's own login, so their session is revoked and re-syncs with
  // the App now gone; for an org account no session carries that login, so the bump is a
  // harmless no-op row. Best-effort; never block the uninstall on it.
  for (const o of orgs) {
    try {
      await bumpSessionVersion(o.slug);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * PAUSE (do NOT tear down) an installation on a GitHub `installation.suspend` — a REVERSIBLE state
 * (billing lapse, an admin "Suspend" toggle). Drops the cached token (it can't be minted while
 * suspended) and pauses scheduled rescans by clearing `nextScanAt` for the org(s) this installation
 * backs, so listDueRescans stops returning them (and the cron doesn't burn doomed 401 token mints).
 * DELIBERATELY KEEPS `watched`, the per-repo `scanSchedule`, and `githubInstallId` intact, and does NOT
 * bump session versions — a temporary suspension must be fully recoverable, which {@link resumeInstallation}
 * (on `unsuspend`) does by re-arming the schedules. Contrast {@link removeInstallation}, the permanent
 * uninstall teardown that unwatches everything, nulls the install id, and revokes sessions. No-op without
 * a DB (the App can run DB-less).
 */
export async function suspendInstallation(installationId: number | string): Promise<void> {
  invalidateInstallationToken(installationId);
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const orgs = await prisma.organization.findMany({
    where: { githubInstallId: String(installationId) },
    select: { id: true },
  });
  if (!orgs.length) return;
  // Pause without losing cadence: a null nextScanAt drops out of listDueRescans (which requires
  // nextScanAt <= now), while `watched` and `scanSchedule` are preserved for resume.
  await prisma.repository.updateMany({
    where: { orgId: { in: orgs.map((o) => o.id) }, scanSchedule: { not: "off" } },
    data: { nextScanAt: null },
  });
}

/**
 * RESUME autoscans after a GitHub `installation.unsuspend` lifts a suspension — the inverse of
 * {@link suspendInstallation}. The watch flags and per-repo schedules were preserved by suspend, so the
 * only thing to restore is the paused `nextScanAt`: mark every watched, non-"off" repo of the
 * installation's org(s) due now, so the autoscan cron picks them up on its next pass (claimRescan then
 * re-phases each to its own cadence). Scanning them promptly is also correct — push webhooks were
 * suppressed during the suspension, so watched repos may have drifted and want a catch-up scan. No-op
 * without a DB.
 */
export async function resumeInstallation(installationId: number | string): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const orgs = await prisma.organization.findMany({
    where: { githubInstallId: String(installationId) },
    select: { id: true },
  });
  if (!orgs.length) return;
  await prisma.repository.updateMany({
    where: { orgId: { in: orgs.map((o) => o.id) }, watched: true, scanSchedule: { not: "off" } },
    data: { nextScanAt: new Date() },
  });
}

/**
 * Reconcile the watched set against an installation's CURRENT accessible repos (the live set from
 * listInstallationRepos). Unwatches any WATCHED repo for the installation's org(s) that is no longer in
 * that set — catching access changes GitHub does NOT itemize as explicit "removed" rows: a
 * "selected → all" flip sends an empty `repositories_removed`, and an "all → selected" narrowing may
 * paginate them. Leaving such repos watched mints a token that no longer covers them and 401s their
 * scheduled rescan forever. Added repos are deliberately NOT auto-watched (watching stays opt-in).
 * Returns the number of repos unwatched. CALLER MUST only pass a live set from a SUCCESSFUL listing —
 * an empty array means "zero accessible repos" and will unwatch all of them, so never call this with
 * the result of a failed/throwing list. No-op without a DB.
 */
export async function reconcileWatchedRepos(
  installationId: number | string,
  liveFullNames: string[],
): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  const orgs = await prisma.organization.findMany({
    where: { githubInstallId: String(installationId) },
    select: { id: true },
  });
  if (!orgs.length) return 0;
  const orgIds = orgs.map((o) => o.id);
  const live = new Set(liveFullNames.map((n) => n.toLowerCase()));
  const watched = await prisma.repository.findMany({
    where: { orgId: { in: orgIds }, watched: true },
    select: { id: true, fullName: true },
  });
  const staleIds = watched.filter((r) => !live.has(r.fullName.toLowerCase())).map((r) => r.id);
  if (staleIds.length === 0) return 0;
  await prisma.repository.updateMany({
    where: { id: { in: staleIds } },
    data: { watched: false, scanSchedule: "off", nextScanAt: null },
  });
  return staleIds.length;
}

/** Resolve a repo owner (login) to its stored installation id, if any. */
export async function getInstallationIdForOwner(owner: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({
    where: { slug: owner.toLowerCase() },
    select: { githubInstallId: true },
  });
  return org?.githubInstallId ?? null;
}
