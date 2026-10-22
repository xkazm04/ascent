// The org's one Subscription row (orgId @unique): the record of WHICH Polar subscription granted the
// current tier (stripeId holds the Polar subscription id) and whether that grant is live (status).
// The grant writes it active, a downgrade writes it inactive, and tier revocation reads it back to scope
// a revoke to its granting subscription (see tierRevocationModel.ts). It is also the conversion event
// `freeToPaidConversion` reads; update never touches createdAt, so converted-then-cancelled still
// converted.

import { getOrgId, getPrisma, isDbConfigured } from "@/lib/db";
import type { SubscriptionRowStatus } from "./tierRevocationModel";

export interface OrgSubscriptionRecord {
  stripeId: string | null;
  status: string;
}

/** The org's Subscription row, or null when none exists (or no DB is configured). Throws when the org
 *  id cannot be resolved so the webhook surfaces a non-2xx and Polar retries. */
export async function getOrgSubscription(org: string): Promise<OrgSubscriptionRecord | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(org);
  if (!orgId) {
    throw new Error(`[billing/webhook] cannot read Subscription for "${org}": org id not found, will retry`);
  }
  const row = await getPrisma().subscription.findUnique({
    where: { orgId },
    select: { stripeId: true, status: true },
  });
  return row ? { stripeId: row.stripeId ?? null, status: row.status } : null;
}

/**
 * Conversion event `freeToPaidConversion` reads. Polar fulfilment already writes Organization.plan;
 * without this row the table stays empty and the KPI is null (not 0%). `stripeId` holds the Polar
 * subscription id in the existing column. Update never includes createdAt.
 */
export async function upsertOrgSubscription(
  org: string,
  data: { status: SubscriptionRowStatus; stripeId: string | null },
): Promise<void> {
  if (!isDbConfigured()) return;
  const orgId = await getOrgId(org);
  if (!orgId) {
    throw new Error(`[billing/webhook] cannot record Subscription for "${org}": org id not found, will retry`);
  }
  await getPrisma().subscription.upsert({
    where: { orgId },
    create: { orgId, status: data.status, stripeId: data.stripeId },
    update: { status: data.status, stripeId: data.stripeId },
  });
}
