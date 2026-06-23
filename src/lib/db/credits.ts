// Prepaid scan-credit accounting — the ledger + balance behind Organization.scanCredits.
//
// Public scans are free and unmetered; each PRIVATE (installation-token) scan that runs real LLM
// inference debits one credit. The `enterprise` plan is unlimited (never debited). Every movement is
// recorded in CreditLedger (append-only) with the resulting balance, so the running total is auditable
// and reconcilable against Polar top-ups. The route-level gate is src/lib/entitlement.ts; the purchase
// flow (Polar checkout + webhook) is src/app/api/billing/* and docs/BILLING.md.

import { randomUUID } from "node:crypto";
import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import { isUnlimitedPlan, resolveScanCharge } from "@/lib/plans";

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

/** Period reconciliation of metered scans against the credit ledger (USE-4). */
export interface CreditReconciliation {
  /** Credits spent (sum of negative deltas, as a positive number) in the window. */
  debited: number;
  /** Credits returned by failed/deduped scans (positive deltas whose reason says "refund"). */
  refunded: number;
  /** Other positive deltas in the window (grants / top-ups). */
  granted: number;
  /** Net credit change in the window (all deltas summed). */
  net: number;
  /** Ledger rows that fell inside the window. */
  entries: number;
}

/** Current balance + plan for an org. Missing org / no DB => zero balance on the free plan. */
export async function getCreditState(orgSlug: string): Promise<CreditState> {
  if (!isDbConfigured()) return { balance: 0, plan: "free", unlimited: false };
  const org = await getPrisma().organization.findUnique({
    // Org slugs are canonically lowercase (authz + setOrgPlan normalize); the credit paths didn't, so
    // a mixed-case slug read $0/free and wrongly paywalled a paid org (or made debits silent no-ops).
    where: { slug: orgSlug.toLowerCase() },
    select: { scanCredits: true, plan: true },
  });
  const plan = org?.plan ?? "free";
  return { balance: org?.scanCredits ?? 0, plan, unlimited: isUnlimitedPlan(plan) };
}

/** Prisma "unique constraint failed" (P2002) — here, a duplicate externalId from a webhook redelivery. */
function isDuplicateExternalId(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Atomically add credits (or remove, with a negative amount) and append a ledger row stamping the
 * resulting balance. Returns the new balance, or null when the org doesn't exist / no DB. Used by the
 * owner-gated grant endpoint and the Polar top-up webhook (src/app/api/billing/webhook). The stored
 * balance is clamped at zero so an over-large negative adjustment can't drive it negative.
 *
 * `opts.externalId` makes the grant IDEMPOTENT: pass a stable id (a Polar order id) and a redelivery
 * is a no-op — a ledger row already carrying it short-circuits, and a concurrent duplicate that slips
 * past that check is caught by the unique constraint (the whole grant rolls back) and reported as the
 * current balance. So a webhook can safely retry without ever double-granting.
 */
export async function grantCredits(
  orgSlug: string,
  amount: number,
  opts: { reason?: string; actor?: string; externalId?: string } = {},
): Promise<number | null> {
  if (!isDbConfigured()) return null;
  const slug = orgSlug.toLowerCase(); // canonical-casing contract (see getCreditState)
  const delta = Math.trunc(amount);
  if (!delta) return (await getCreditState(slug)).balance;
  const prisma = getPrisma();
  // Idempotency key for the withRetry wrapper below. A caller-supplied externalId (a Polar order id)
  // dedups cross-delivery. Callers that pass NONE — the per-scan refunds fired from concurrent
  // mapPool lanes against DSQL (where OCC/serialization retries are expected), and owner grants —
  // were non-idempotent: withRetry re-runs the whole closure on a retryable error / commit-ambiguity
  // blip, appending a second +1 (over-refund → free private scans). Synthesize a per-INVOCATION id so
  // a RETRY of THIS call collapses (the unique-constraint catch below), while a genuinely separate
  // grant/refund still gets its own id and is never suppressed.
  const externalId = opts.externalId ?? `auto:${randomUUID()}`;
  // Fast path for a caller-supplied redelivery: this exact grant already landed, so don't even try
  // again. (Only the caller-supplied case can pre-exist; a freshly synthesized id never will, so it
  // relies on the unique-constraint catch instead — no extra read on the hot refund path.)
  if (opts.externalId) {
    const existing = await prisma.creditLedger
      .findUnique({ where: { externalId: opts.externalId }, select: { id: true } })
      .catch(() => null);
    if (existing) return (await getCreditState(slug)).balance;
  }
  try {
    return await withRetry(() =>
      prisma.$transaction(async (tx) => {
        const org = await tx.organization.findUnique({
          where: { slug },
          select: { id: true, scanCredits: true },
        });
        if (!org) return null;
        // Clamp a debit to the available balance and stamp the ledger with the delta we ACTUALLY
        // applied. The old code did `increment: delta` and then a SECOND absolute `scanCredits: 0`
        // write to clamp — which (a) broke the append-only invariant `prev + delta === balanceAfter`
        // (a -100 against 30 stamped delta=-100, balanceAfter=0, so reconciliation drifts forever),
        // and (b) could clobber a concurrent debit/grant landing between the increment and the absolute
        // set. One relative increment by the clamped delta keeps both the balance and the ledger honest.
        const appliedDelta = delta >= 0 ? delta : Math.max(delta, -org.scanCredits);
        if (appliedDelta === 0) return org.scanCredits; // nothing to apply (debit against empty balance)
        const updated = await tx.organization.update({
          where: { id: org.id },
          data: { scanCredits: { increment: appliedDelta } },
          select: { scanCredits: true },
        });
        const balanceAfter = updated.scanCredits;
        await tx.creditLedger.create({
          data: {
            orgId: org.id,
            delta: appliedDelta,
            balanceAfter,
            reason: opts.reason ?? (delta > 0 ? "grant" : "adjustment"),
            actor: opts.actor ?? null,
            externalId,
          },
        });
        return balanceAfter;
      }),
    );
  } catch (err) {
    // A retry/redelivery lost the race to the unique externalId; its insert rolled the whole grant
    // back (the increment too). Treat it as already-applied rather than surfacing an error. Covers
    // both a caller-supplied externalId (webhook redelivery) and the synthesized per-invocation id
    // (commit-ambiguity retry of a refund/grant), so neither can double-apply.
    if (isDuplicateExternalId(err)) {
      return (await getCreditState(slug)).balance;
    }
    throw err;
  }
}

/**
 * Count the org's metered scans so far this calendar month — the allowance-usage basis. Cached/dedup
 * re-scans persist NO new Scan row (so they're naturally free), and degraded-to-mock runs are excluded
 * (engineProvider "mock"), so this counts only the real-inference scans that draw on the allowance.
 */
export async function countMeteredScansThisMonth(orgSlug: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } });
  if (!org) return 0;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return prisma.scan.count({
    where: { repo: { orgId: org.id }, scannedAt: { gte: monthStart }, engineProvider: { not: "mock" } },
  });
}

/**
 * Consume the budget for one metered scan under the hybrid model: FREE on the unlimited plan, FREE
 * while the org is under its monthly allowance, then ONE prepaid credit (atomic, balance-clamped), else
 * denied. Returns { ok, balance, unlimited, charged } — `charged` is true ONLY when a credit was
 * actually debited, so the caller refunds (on dedup/degrade) exactly that and nothing else. The
 * allowance pre-check is a soft read (a boundary race can free one extra scan — fine for an allowance);
 * the credit decrement remains the concurrency-safe hard gate.
 */
export async function consumeScanCredit(
  orgSlug: string,
  ctx: { repoFullName?: string; scanId?: string; actor?: string } = {},
): Promise<{ ok: boolean; balance: number; unlimited: boolean; charged: boolean }> {
  if (!isDbConfigured()) return { ok: true, balance: 0, unlimited: false, charged: false };
  const prisma = getPrisma();
  const slug = orgSlug.toLowerCase(); // canonical-casing contract (see getCreditState)

  // Allowance gate (reads): unlimited or under the monthly allowance → free, no debit.
  const org0 = await prisma.organization.findUnique({ where: { slug }, select: { plan: true, scanCredits: true } });
  if (!org0) return { ok: false, balance: 0, unlimited: false, charged: false };
  if (isUnlimitedPlan(org0.plan)) return { ok: true, balance: org0.scanCredits, unlimited: true, charged: false };
  const charge = resolveScanCharge({
    plan: org0.plan,
    usageThisMonth: await countMeteredScansThisMonth(slug),
    balance: org0.scanCredits,
  });
  if (charge === "allowance") return { ok: true, balance: org0.scanCredits, unlimited: false, charged: false };
  if (charge === "denied") return { ok: false, balance: org0.scanCredits, unlimited: false, charged: false };

  // Overflow → debit one credit, atomically and balance-clamped.
  return withRetry(() =>
    prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { slug },
        select: { id: true, scanCredits: true },
      });
      if (!org) return { ok: false, balance: 0, unlimited: false, charged: false };
      const dec = await tx.organization.updateMany({
        where: { slug, scanCredits: { gt: 0 } },
        data: { scanCredits: { decrement: 1 } },
      });
      if (dec.count === 0) return { ok: false, balance: org.scanCredits, unlimited: false, charged: false };
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
      return { ok: true, balance: balanceAfter, unlimited: false, charged: true };
    }),
  );
}

/** Set an org's plan tier (owner-gated at the route). Returns false for an unknown org / no DB. */
export async function setOrgPlan(orgSlug: string, plan: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const res = await getPrisma().organization.updateMany({ where: { slug: orgSlug.toLowerCase() }, data: { plan } });
  return res.count > 0;
}

/** Recent ledger rows for an org (newest first). */
export async function getCreditLedger(orgSlug: string, limit = 50): Promise<CreditLedgerEntry[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } });
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

/**
 * Reconcile the credit ledger over the last `days` (USE-4): credits debited (scan spends), refunded
 * (failed/deduped scans return their credit — a positive delta whose reason says so), granted (other
 * positives), and the net. Windows the recent ledger rows by date here (server-side) so the /usage
 * page stays a pure render. Null when persistence is off.
 */
export async function getCreditReconciliation(orgSlug: string, days: number): Promise<CreditReconciliation | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } });
  if (!org) return null;
  // Aggregate over the FULL window, NOT the recent-200 list. The old code reused
  // getCreditLedger(orgSlug, 200) — capped at the newest 200 rows — as its source, so a busy fleet
  // (daily autoscans write 20-40 ledger rows/day) silently lost every row beyond the most-recent 200
  // in a 30-day window, understating debited/refunded/granted/net on the money-facing /usage page.
  // Select only the two fields the reconciliation needs, for all rows inside the window.
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86_400_000);
  const rows = await prisma.creditLedger.findMany({
    where: { orgId: org.id, createdAt: { gte: cutoff } },
    select: { delta: true, reason: true },
  });
  const sum = (pred: (e: { delta: number; reason: string }) => boolean, abs = false) =>
    rows.filter(pred).reduce((a, e) => a + (abs ? Math.abs(e.delta) : e.delta), 0);
  return {
    debited: sum((e) => e.delta < 0, true),
    refunded: sum((e) => e.delta > 0 && /refund/i.test(e.reason)),
    granted: sum((e) => e.delta > 0 && !/refund/i.test(e.reason)),
    net: rows.reduce((a, e) => a + e.delta, 0),
    entries: rows.length,
  };
}
