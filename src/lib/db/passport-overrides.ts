// Owner-set App Readiness Passport overrides (P4 + 0.2.0 declines) — the fields a scan can't observe
// (criticality / lifecycle / rollback) and the gaps an owner has explicitly DECLINED BY CHOICE. Stored per
// repo (Repository.passportOverridesJson) and applied as a READ-TIME overlay over the scan-derived
// passport (getRepoPassport + getOrgRollup), so the stored scan stays untouched and a changed override
// shows immediately without a re-scan. Set is owner-gated at the route.
//
// RE-SCAN SURVIVAL: this column is written ONLY here. A scan writes passportJson (scans-persist) and never
// touches passportOverridesJson, so declines are decision memory that outlives every regeneration.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { parsePassportOverrides, type DeclineEntry, type PassportOverrides } from "@/lib/analyze/passport";

/** Read a repo's stored overrides (validated), or null when none/off/unknown. */
export async function getPassportOverrides(orgSlug: string, repoFullName: string): Promise<PassportOverrides | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName: repoFullName } },
    select: { passportOverridesJson: true },
  });
  return parsePassportOverrides(repo?.passportOverridesJson);
}

/** Upsert a repo's overrides (validated/sanitized; empty clears them). False if the repo is unknown. */
export async function setPassportOverrides(orgSlug: string, repoFullName: string, overrides: PassportOverrides): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  // Sanitize through the same validator the read path uses (drops unknown enums); empty → clear (null).
  const clean = parsePassportOverrides(JSON.stringify(overrides));
  const res = await prisma.repository.updateMany({
    where: { orgId, fullName: repoFullName },
    data: { passportOverridesJson: clean ? JSON.stringify(clean) : null },
  });
  return res.count > 0;
}

/**
 * PATCH semantics for declined-by-choice: merge `changes` into the stored declines, keyed by field path.
 * A `null` value REMOVES that path (the owner changed their mind); everything else in the overrides blob
 * (criticality/lifecycle/rollback and untouched declines) is preserved. Validated through the same parser
 * the read path uses, so an unknown field path can never be written. False if the repo is unknown.
 */
export async function mergePassportDeclines(
  orgSlug: string,
  repoFullName: string,
  changes: Record<string, DeclineEntry | null>,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName: repoFullName } },
    select: { passportOverridesJson: true },
  });
  if (!repo) return false;

  const current = parsePassportOverrides(repo.passportOverridesJson) ?? {};
  const declined: Record<string, DeclineEntry> = { ...(current.declined ?? {}) };
  for (const [path, entry] of Object.entries(changes)) {
    if (entry === null) delete declined[path];
    else declined[path] = entry;
  }
  const next: PassportOverrides = { ...current, ...(Object.keys(declined).length ? { declined } : {}) };
  if (!Object.keys(declined).length) delete next.declined;
  const clean = parsePassportOverrides(JSON.stringify(next));
  await prisma.repository.updateMany({
    where: { orgId, fullName: repoFullName },
    data: { passportOverridesJson: clean ? JSON.stringify(clean) : null },
  });
  return true;
}
