// LOCAL MODE pairing db layer — reads and writes of Repository.localPath, the mapping from a fleet
// repo to its working copy on the SERVER's filesystem (self-hosted deployments only; the routes that
// call the writers are self-host-gated, this layer just persists).
//
// The path is stored VERIFIED-AT-WRITE only: verifyLocalPath runs in the route before setRepoLocalPath,
// and again at every USE (local rescan / autopilot), so a folder that moved after pairing fails with
// a fresh, actionable reason. Nothing here re-checks the filesystem — db code stays fs-free.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

export interface LocalPairing {
  fullName: string;
  localPath: string | null;
  watched: boolean;
  isPrivate: boolean;
  lastScanAt: string | null;
}

/** Every repo in the org's fleet with its pairing state — the Pairing tab's one read. Paired rows
 *  first (they are what the tab manages), then by name for a stable scan order. */
export async function listLocalPairings(orgSlug: string): Promise<LocalPairing[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().repository.findMany({
    where: { orgId },
    select: { fullName: true, localPath: true, watched: true, isPrivate: true, lastScanAt: true },
    orderBy: { fullName: "asc" },
  });
  return rows
    .map((r) => ({
      fullName: r.fullName,
      localPath: r.localPath,
      watched: r.watched,
      isPrivate: r.isPrivate,
      lastScanAt: r.lastScanAt ? r.lastScanAt.toISOString() : null,
    }))
    .sort((a, b) => Number(b.localPath != null) - Number(a.localPath != null) || a.fullName.localeCompare(b.fullName));
}

/** The paired path for one repo, or null when unpaired/unknown — the read every local scan starts
 *  from. Tenancy: scoped by org, so one org's pairing can never serve another's scan. */
export async function getRepoLocalPath(orgSlug: string, fullName: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const row = await getPrisma().repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
    select: { localPath: true },
  });
  return row?.localPath ?? null;
}

/** Pair (or, with null, unpair) a repo's local path. Returns false when the repo row doesn't exist —
 *  pairing never CREATES fleet membership; adding a repo to the fleet is setRepoWatch's job. */
export async function setRepoLocalPath(orgSlug: string, fullName: string, localPath: string | null): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const updated = await getPrisma()
    .repository.update({
      where: { orgId_fullName: { orgId, fullName } },
      data: { localPath },
      select: { id: true },
    })
    .catch(() => null);
  return updated !== null;
}
