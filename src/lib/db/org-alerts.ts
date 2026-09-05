// Per-org alert sink — the routing half of the multi-tenant alert layer. The alert dispatchers
// (regressions, low-credit pushes, the weekly digest) were built single-tenant against one global
// ALERT_WEBHOOK_URL, so every tenant's fleet intelligence landed in the operator's channel. These
// helpers read/write Organization.alertWebhookUrl; resolution order at the dispatch sites is
// org URL → global env → no-op (see resolveAlertWebhook in src/lib/alerts.ts). Guarded by
// DATABASE_URL like the rest of the db layer.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

/**
 * Resolve the org (canonical {@link getOrgId} lookup), then apply a partial update to its row.
 * Returns false when persistence is off or the org is unknown (so the setters can return undefined),
 * true on a successful update. Factors the resolve→guard→update tail both setters repeated.
 */
async function updateOrgById(orgSlug: string, data: Prisma.OrganizationUpdateInput): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  await getPrisma().organization.update({ where: { id: orgId }, data });
  return true;
}

/** The org's configured alert webhook URL, or null (unset / unknown org / DB-less). */
export async function getOrgAlertWebhook(orgSlug: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug.toLowerCase() },
    select: { alertWebhookUrl: true },
  });
  return org?.alertWebhookUrl ?? null;
}

/**
 * Set (or clear, with null) the org's alert webhook. Returns the stored value, or undefined when
 * the org doesn't exist. Validation (https, length) is the API route's job — this is storage only.
 */
export async function setOrgAlertWebhook(orgSlug: string, url: string | null): Promise<string | null | undefined> {
  return (await updateOrgById(orgSlug, { alertWebhookUrl: url })) ? url : undefined;
}

/** Per-org regression sensitivity overrides (points); null = inherit DEFAULT_THRESHOLDS. */
export interface OrgAlertThresholds {
  overallDrop: number | null;
  dimensionDrop: number | null;
}

/** The org's regression thresholds, or nulls (unset / unknown org / DB-less → inherit defaults). */
export async function getOrgAlertThresholds(orgSlug: string): Promise<OrgAlertThresholds> {
  if (!isDbConfigured()) return { overallDrop: null, dimensionDrop: null };
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug.toLowerCase() },
    select: { alertOverallDrop: true, alertDimensionDrop: true },
  });
  return { overallDrop: org?.alertOverallDrop ?? null, dimensionDrop: org?.alertDimensionDrop ?? null };
}

/** Set/clear the org's regression thresholds (null clears a field back to the default). undefined = unknown org. */
export async function setOrgAlertThresholds(
  orgSlug: string,
  t: OrgAlertThresholds,
): Promise<OrgAlertThresholds | undefined> {
  const updated = await updateOrgById(orgSlug, { alertOverallDrop: t.overallDrop, alertDimensionDrop: t.dimensionDrop });
  return updated ? t : undefined;
}
