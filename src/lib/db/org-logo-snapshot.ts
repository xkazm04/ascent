// The org's white-label logo snapshot (OrgLogoSnapshot): the bytes the branding save validated, as a
// data URI, keyed to the logo URL they were fetched from. Read by readDeliverableBranding
// (src/lib/branding/deliverable.ts) so the board PDF and the share page render with no network call;
// written by the branding save and by the door's one-time heal. A cache, never a source of truth:
// Organization.logoUrl is the setting. No-op / null when persistence is off, like the rest of
// src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

export interface OrgLogoSnapshot {
  sourceUrl: string;
  status: "ok" | "failed";
  dataUri: string | null;
  sha256: string | null;
  mime: string | null;
  reason: string | null;
  /** ISO string, never a Date (the wire-safe convention, even though this stays server-side). */
  fetchedAt: string;
}

/** A validated logo to store, or a failed fetch to remember (the negative entry). */
export type OrgLogoSnapshotInput =
  | { sourceUrl: string; sha256: string; mime: string; dataUri: string }
  | { sourceUrl: string; failure: string };

async function orgIdOf(orgSlug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  return org?.id ?? null;
}

/** The org's snapshot, or null when there is none / the org is unknown / persistence is off. */
export async function getOrgLogoSnapshot(orgSlug: string): Promise<OrgLogoSnapshot | null> {
  if (!isDbConfigured()) return null;
  const orgId = await orgIdOf(orgSlug);
  if (!orgId) return null;
  const row = await getPrisma().orgLogoSnapshot.findUnique({ where: { orgId } });
  if (!row) return null;
  return {
    sourceUrl: row.sourceUrl,
    status: row.status === "ok" ? "ok" : "failed",
    dataUri: row.dataUri,
    sha256: row.sha256,
    mime: row.mime,
    reason: row.reason,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

/** Replace the org's one snapshot row. False when the org is unknown or persistence is off. */
export async function setOrgLogoSnapshot(orgSlug: string, input: OrgLogoSnapshotInput): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await orgIdOf(orgSlug);
  if (!orgId) return false;
  const data =
    "failure" in input
      ? { sourceUrl: input.sourceUrl, status: "failed", dataUri: null, sha256: null, mime: null, reason: input.failure }
      : { sourceUrl: input.sourceUrl, status: "ok", dataUri: input.dataUri, sha256: input.sha256, mime: input.mime, reason: null };
  const fetchedAt = new Date();
  await getPrisma().orgLogoSnapshot.upsert({
    where: { orgId },
    create: { orgId, ...data, fetchedAt },
    update: { ...data, fetchedAt },
  });
  return true;
}
