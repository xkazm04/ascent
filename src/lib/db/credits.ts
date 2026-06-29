// Prepaid scan-credit accounting — the ledger + balance behind Organization.scanCredits.
//
// Public scans are free and unmetered; each PRIVATE (installation-token) scan that runs real LLM
// inference debits one credit. The `enterprise` plan is unlimited (never debited). Every movement is
// recorded in CreditLedger (append-only) with the resulting balance, so the running total is auditable
// and reconcilable against Polar top-ups. The route-level gate is src/lib/entitlement.ts; the purchase
// flow (Polar checkout + webhook) is src/app/api/billing/* and docs/BILLING.md.

import { randomUUID } from "node:crypto";
import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { isUnlimitedPlan, resolveScanCharge } from "@/lib/plans";

/**
 * Canonical CreditLedger `reason` values. The refund WRITERS (scan-credit.refundScanCredit and the
 * /api/scan inline refund) and the reconciliation READER (getCreditReconciliation) must agree on the
 * refund marker: the prior free-text `/refund/i` substring would mis-bucket any refund stamped with a
 * reason lacking the word "refund" (e.g. "dedup"/"reverted") as a fresh GRANT — overstating grants and
 * understating refunds on the money-facing /usage reconciliation, while `net` stayed correct so nothing
 * looked broken. Binding both sides to ONE constant makes that drift structurally impossible.
 */
export const CREDIT_REASON = {
  SCAN: "scan",
  GRANT: "grant",
  ADJUSTMENT: "adjustment",
  REFUND: "refund",
  POLAR_REFUND: "polar-refund",
} as const;

/** True iff a (positive-delta) ledger reason marks a scan-credit refund — an EXACT match on the shared
 *  CREDIT_REASON.REFUND constant (trim/case-tolerant), not a substring, so only a genuine refund row
 *  lands in the reconciliation's `refunded` bucket and a non-refund reason can never leak into it. */
export function isRefundReason(reason: string | null | undefined): boolean {
  return (reason ?? "").trim().toLowerCase() === CREDIT_REASON.REFUND;
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
            reason: opts.reason ?? (delta > 0 ? CREDIT_REASON.GRANT : CREDIT_REASON.ADJUSTMENT),
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
 * Idempotently claw back credits for a (partially or fully) refunded Polar order. Polar's
 * `order.refundedAmount` is CUMULATIVE — one order can emit several refund events with a growing
 * amount — so the caller passes the CUMULATIVE TARGET clawback (round(packCredits · refundedFraction))
 * and this applies only the MARGINAL share not yet reversed for the order. All of an order's refund
 * clawbacks share the `polar-refund:<orderId>:` externalId prefix; their sum is the already-clawed
 * total, and `eventKey` (the cumulative refunded amount) makes each refund EVENT idempotent — a webhook
 * redelivery of the same event collapses on the unique externalId, while a later, larger refund applies
 * its own increment. The stored balance is clamped at zero. Returns the new balance, or null when the
 * org doesn't exist / no DB.
 *
 * This replaces a per-ORDER idempotency key (`polar-refund:<orderId>`) that collapsed every refund
 * event into the first — so a partial-then-full (or any N>1) refund only reversed the first increment
 * and the buyer kept the rest of the pack for free.
 */
export async function clawbackOrderRefund(
  orgSlug: string,
  orderId: string,
  targetClawback: number,
  opts: { eventKey: string; actor?: string },
): Promise<number | null> {
  if (!isDbConfigured()) return null;
  const slug = orgSlug.toLowerCase(); // canonical-casing contract (see getCreditState)
  const target = Math.max(0, Math.trunc(targetClawback));
  const prisma = getPrisma();
  const prefix = `polar-refund:${orderId}:`;
  const externalId = `${prefix}${opts.eventKey}`;
  // Fast path: this exact refund event already landed (a webhook redelivery) — don't re-apply.
  const seen = await prisma.creditLedger
    .findUnique({ where: { externalId }, select: { id: true } })
    .catch(() => null);
  if (seen) return (await getCreditState(slug)).balance;
  try {
    return await withRetry(() =>
      prisma.$transaction(async (tx) => {
        const org = await tx.organization.findUnique({ where: { slug }, select: { id: true, scanCredits: true } });
        if (!org) return null;
        // How much has ALREADY been clawed back for THIS order across prior refund events.
        const prior = await tx.creditLedger.aggregate({
          where: { orgId: org.id, externalId: { startsWith: prefix } },
          _sum: { delta: true },
        });
        const alreadyClawed = Math.abs(prior._sum.delta ?? 0);
        const marginal = target - alreadyClawed;
        if (marginal <= 0) return org.scanCredits; // nothing new to reverse for this cumulative amount
        const appliedDelta = Math.max(-marginal, -org.scanCredits); // clamp: never drive balance negative
        if (appliedDelta === 0) return org.scanCredits; // balance already spent — nothing left to claw
        const updated = await tx.organization.update({
          where: { id: org.id },
          data: { scanCredits: { increment: appliedDelta } },
          select: { scanCredits: true },
        });
        await tx.creditLedger.create({
          data: {
            orgId: org.id,
            delta: appliedDelta,
            balanceAfter: updated.scanCredits,
            reason: CREDIT_REASON.POLAR_REFUND,
            actor: opts.actor ?? "polar",
            externalId,
          },
        });
        return updated.scanCredits;
      }),
    );
  } catch (err) {
    // A redelivery lost the race to the unique externalId; its insert rolled the whole clawback back.
    // Treat it as already-applied (report the current balance) rather than surfacing an error.
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
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return 0;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return prisma.scan.count({
    where: { repo: { orgId }, scannedAt: { gte: monthStart }, engineProvider: { not: "mock" } },
  });
}

/**
 * Consume the budget for one metered scan under the hybrid model: FREE on the unlimited plan, FREE
 * while the org is under its monthly allowance, then ONE prepaid credit (atomic, balance-clamped), else
 * denied. Returns { ok, balance, unlimited, charged } — `charged` is true ONLY when a credit was
 * actually debited, so the caller refunds (on dedup/degrade) exactly that and nothing else.
 *
 * The allowance pre-check is a SOFT, non-atomic read: usageThisMonth counts persisted Scan rows, which
 * land only AFTER a lane reserves, so concurrent lanes at the allowance boundary all read the same stale
 * count and each classify "allowance" (free). The overshoot is therefore O(in-flight lanes) per boundary
 * crossing — up to SCAN_CONCURRENCY-1 per batch, more across simultaneous batches — NOT "one". This is
 * an accepted soft gate: the credit decrement below (conditional `updateMany ... scanCredits > 0`) is the
 * concurrency-safe HARD money gate, so only the FREE allowance can be marginally overshot, never paid
 * credits. A hard allowance bound would need an atomic monthly-usage counter (a schema change).
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
  //
  // Idempotency key, STABLE across retries of THIS invocation (synthesized ONCE, outside withRetry).
  // The grant path defends against a withRetry re-application via a unique externalId; the symmetric
  // -1 debit did NOT, so a commit-ambiguity blip (the COMMIT acked-lost, then retried) re-ran the whole
  // closure: a SECOND decrement + a SECOND `delta:-1` row → the org charged twice for one scan; and at
  // balance=1 the retry's conditional decrement found 0 and reported a PAID scan as denied. A scanId
  // gives a natural key; otherwise synthesize a per-invocation id (mirrors grantCredits).
  const externalId = ctx.scanId ? `scan:${ctx.scanId}` : `auto:${randomUUID()}`;
  try {
    return await withRetry(() =>
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
        if (dec.count === 0) {
          // Either genuinely out of credits, OR a prior (acked-lost) attempt of THIS invocation already
          // debited + committed and we're re-running. Distinguish via the deterministic externalId so a
          // retry of a scan that WAS paid isn't mis-reported as denied (and later wrongly re-charged).
          const prior = await tx.creditLedger
            .findUnique({ where: { externalId }, select: { id: true } })
            .catch(() => null);
          if (prior) return { ok: true, balance: org.scanCredits, unlimited: false, charged: true };
          return { ok: false, balance: org.scanCredits, unlimited: false, charged: false };
        }
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
            reason: CREDIT_REASON.SCAN,
            repoFullName: ctx.repoFullName ?? null,
            scanId: ctx.scanId ?? null,
            actor: ctx.actor ?? null,
            externalId,
          },
        });
        return { ok: true, balance: balanceAfter, unlimited: false, charged: true };
      }),
    );
  } catch (err) {
    // A retry lost the race to the unique externalId — the duplicate insert rolled the whole debit
    // (the decrement too) back, so the credit was charged exactly once by the winning attempt. Report
    // the post-debit balance as a successful, charged debit rather than surfacing the error.
    if (isDuplicateExternalId(err)) {
      const state = await getCreditState(slug);
      return { ok: true, balance: state.balance, unlimited: false, charged: true };
    }
    throw err;
  }
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
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  return prisma.creditLedger.findMany({
    where: { orgId },
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
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  // Aggregate over the FULL window, NOT the recent-200 list. The old code reused
  // getCreditLedger(orgSlug, 200) — capped at the newest 200 rows — as its source, so a busy fleet
  // (daily autoscans write 20-40 ledger rows/day) silently lost every row beyond the most-recent 200
  // in a 30-day window, understating debited/refunded/granted/net on the money-facing /usage page.
  // Select only the two fields the reconciliation needs, for all rows inside the window.
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86_400_000);
  const rows = await prisma.creditLedger.findMany({
    where: { orgId, createdAt: { gte: cutoff } },
    select: { delta: true, reason: true },
  });
  const sum = (pred: (e: { delta: number; reason: string }) => boolean, abs = false) =>
    rows.filter(pred).reduce((a, e) => a + (abs ? Math.abs(e.delta) : e.delta), 0);
  return {
    debited: sum((e) => e.delta < 0, true),
    // Classify on the shared CREDIT_REASON.REFUND constant (see isRefundReason), NOT a free-text
    // substring, so a refund stamped with any other reason can't silently land in `granted`.
    refunded: sum((e) => e.delta > 0 && isRefundReason(e.reason)),
    granted: sum((e) => e.delta > 0 && !isRefundReason(e.reason)),
    net: rows.reduce((a, e) => a + e.delta, 0),
    entries: rows.length,
  };
}
