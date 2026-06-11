// Prepaid scan-credit accounting — the ledger + balance behind Organization.scanCredits.
//
// Public scans are free and unmetered; each PRIVATE (installation-token) scan that runs real LLM
// inference debits one credit. The `enterprise` plan is unlimited (never debited). Every movement is
// recorded in CreditLedger (append-only) with the resulting balance, so the running total is auditable
// and reconcilable against future Stripe top-ups. The route-level gate is src/lib/entitlement.ts; the
// (design-stage) purchase flow is docs/BILLING.md.

import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";

/** Plans whose private scans are included (never consume credits). */
export function isUnlimitedPlan(plan: string | null | undefined): boolean {
  return plan === "enterprise";
}

export interface CreditState {
  balance: number;
  plan: string;
  unlimited: boolean;
}

export interface CreditLedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  repoFullName: string | null;
  scanId: string | null;
  actor: string | null;
  createdAt: Date;
}

/** Current balance + plan for an org. Missing org / no DB => zero balance on the free plan. */
export async function getCreditState(orgSlug: string): Promise<CreditState> {
  if (!isDbConfigured()) return { balance: 0, plan: "free", unlimited: false };
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug },
    select: { scanCredits: true, plan: true },
  });
  const plan = org?.plan ?? "free";
  return { balance: org?.scanCredits ?? 0, plan, unlimited: isUnlimitedPlan(plan) };
}

/**
 * Atomically add credits (or remove, with a negative amount) and append a ledger row stamping the
 * resulting balance. Returns the new balance, or null when the org doesn't exist / no DB. Used by the
 * owner-gated grant endpoint today and the Stripe top-up webhook later. The stored balance is clamped
 * at zero so an over-large negative adjustment can't drive it negative.
 */
export async function grantCredits(
  orgSlug: string,
  amount: number,
  opts: { reason?: string; actor?: string } = {},
): Promise<number | null> {
  if (!isDbConfigured()) return null;
  const delta = Math.trunc(amount);
  if (!delta) return (await getCreditState(orgSlug)).balance;
  const prisma = getPrisma();
  return withRetry(() =>
    prisma.$transaction(async (tx) => {
      const org = await tx.organization
        .update({
          where: { slug: orgSlug },
          data: { scanCredits: { increment: delta } },
          select: { id: true, scanCredits: true },
        })
        .catch(() => null);
      if (!org) return null;
      const balanceAfter = Math.max(0, org.scanCredits);
      if (org.scanCredits < 0) {
        await tx.organization.update({ where: { id: org.id }, data: { scanCredits: 0 } });
      }
      await tx.creditLedger.create({
        data: {
          orgId: org.id,
          delta,
          balanceAfter,
          reason: opts.reason ?? (delta > 0 ? "grant" : "adjustment"),
          actor: opts.actor ?? null,
        },
      });
      return balanceAfter;
    }),
  );
}

/**
 * Consume exactly one credit for a private scan — atomically, and only if the balance is positive.
 * Returns { ok, balance, unlimited }: ok=false means insufficient credits (nothing debited). Unlimited
 * plans are a no-op (ok=true). The conditional decrement (WHERE scanCredits > 0) means two concurrent
 * scans can't drive the balance negative; under DSQL serialization the loser retries via withRetry.
 */
export async function consumeScanCredit(
  orgSlug: string,
  ctx: { repoFullName?: string; scanId?: string; actor?: string } = {},
): Promise<{ ok: boolean; balance: number; unlimited: boolean }> {
  if (!isDbConfigured()) return { ok: true, balance: 0, unlimited: false };
  const prisma = getPrisma();
  return withRetry(() =>
    prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { slug: orgSlug },
        select: { id: true, scanCredits: true, plan: true },
      });
      if (!org) return { ok: false, balance: 0, unlimited: false };
      if (isUnlimitedPlan(org.plan)) return { ok: true, balance: org.scanCredits, unlimited: true };
      const dec = await tx.organization.updateMany({
        where: { slug: orgSlug, scanCredits: { gt: 0 } },
        data: { scanCredits: { decrement: 1 } },
      });
      if (dec.count === 0) return { ok: false, balance: org.scanCredits, unlimited: false };
      // Re-read AFTER the decrement (same tx) so the ledger stamps the real post-debit balance.
      // Deriving it from the initial read races with concurrent debits: under READ COMMITTED each
      // tx's stale snapshot would stamp the same balanceAfter, corrupting the reconciliation trail.
      const after = await tx.organization.findUniqueOrThrow({
        where: { id: org.id },
        select: { scanCredits: true },
      });
      const balanceAfter = after.scanCredits;
      await tx.creditLedger.create({
        data: {
          orgId: org.id,
          delta: -1,
          balanceAfter,
          reason: "scan",
          repoFullName: ctx.repoFullName ?? null,
          scanId: ctx.scanId ?? null,
          actor: ctx.actor ?? null,
        },
      });
      return { ok: true, balance: balanceAfter, unlimited: false };
    }),
  );
}

/** Recent ledger rows for an org (newest first). */
export async function getCreditLedger(orgSlug: string, limit = 50): Promise<CreditLedgerEntry[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return [];
  return prisma.creditLedger.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(200, limit)),
    select: {
      id: true,
      delta: true,
      balanceAfter: true,
      reason: true,
      repoFullName: true,
      scanId: true,
      actor: true,
      createdAt: true,
    },
  });
}
