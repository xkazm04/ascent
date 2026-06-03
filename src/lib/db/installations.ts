// Persistence for GitHub App installations. An installation maps a GitHub account
// (org/user login) to an installation_id; we store it on Organization.githubInstallId,
// using the login (lowercased) as the org slug so a repo owner resolves to its install.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { bumpSessionVersion } from "@/lib/db/sessions";

export async function upsertInstallation(opts: {
  login: string;
  installationId: number | string;
}): Promise<void> {
  if (!isDbConfigured()) return;
  const slug = opts.login.toLowerCase();
  const installId = String(opts.installationId);
  const update = { githubInstallId: installId, name: opts.login };
  const prisma = getPrisma();
  try {
    await prisma.organization.upsert({
      where: { slug },
      update,
      create: { slug, name: opts.login, plan: "private", githubInstallId: installId },
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

/** Resolve a repo owner (login) to its stored installation id, if any. */
export async function getInstallationIdForOwner(owner: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({
    where: { slug: owner.toLowerCase() },
    select: { githubInstallId: true },
  });
  return org?.githubInstallId ?? null;
}
