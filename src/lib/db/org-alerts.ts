// Per-org alert sink — the routing half of the multi-tenant alert layer. The alert dispatchers
// (regressions, low-credit pushes, the weekly digest) were built single-tenant against one global
// ALERT_WEBHOOK_URL, so every tenant's fleet intelligence landed in the operator's channel. These
// helpers read/write Organization.alertWebhookUrl; resolution order at the dispatch sites is
// org URL → global env → no-op (see resolveAlertWebhook in src/lib/alerts.ts). Guarded by
// DATABASE_URL like the rest of the db layer.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

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
  if (!isDbConfigured()) return undefined;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } });
  if (!org) return undefined;
  await prisma.organization.update({ where: { id: org.id }, data: { alertWebhookUrl: url } });
  return url;
}
