// HOSTED-LANE CREDITS — the IO half of the per-org ceiling (ADR-0001 T2). `hosted-ceiling.ts` decides;
// this module reads the org's plan, balance and month-to-date hosted spend, and moves the credits.
//
// WHERE "SPENT THIS MONTH" COMES FROM. It is counted from the queue itself: hosted-worker lanes on this
// org's runs created since the start of the UTC month, each at its flat reservation. Not from the
// credit ledger, because an unlimited plan is never debited and would read as zero spend — and the
// ceiling exists precisely to bind the org the balance does not. A lane row exists only for a run
// whose reservation succeeded (the debit precedes `createLoopRun`), so every counted lane was paid
// for or was on an unlimited plan.
//
// CONCURRENCY. The balance debit is the HARD gate: a conditional `updateMany … scanCredits >= cost`,
// the pattern `consumeScanCredit` uses, so two arms cannot spend the same credit. The ceiling read is a
// SOFT gate (a count under READ COMMITTED), mitigated twice: the org's one-active-run rule means a
// second arm is refused before it reaches here, and `dispatchHostedLane` re-checks the ceiling before
// any lane is handed to a worker.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured, isP2002Error, withRetry } from "@/lib/db/client";
import { CREDIT_REASON, grantCredits } from "@/lib/db/credits";
import { selfHosted } from "@/lib/env";
import { isUnlimitedPlan } from "@/lib/plans";
import {
  HOSTED_LANE_CREDITS,
  decideHostedCharge,
  hostedMonthStart,
  hostedMonthlyCeiling,
  type HostedChargeBlock,
} from "@/lib/local/hosted-ceiling";

type Db = Pick<Prisma.TransactionClient, "loopRun" | "loopRunLane">;

/** Hosted-lane credits an org has reserved since the start of the UTC month. */
async function spentThisMonth(db: Db, orgId: string, now: Date): Promise<number> {
  const runs = await db.loopRun.findMany({ where: { orgId, createdAt: { gte: hostedMonthStart(now) } }, select: { id: true } });
  if (runs.length === 0) return 0;
  const lanes = await db.loopRunLane.count({ where: { runId: { in: runs.map((r) => r.id) }, executor: "hosted-worker" } });
  return lanes * HOSTED_LANE_CREDITS;
}

export interface HostedCeilingState {
  orgExists: boolean;
  plan: string;
  unlimited: boolean;
  balance: number;
  spentThisMonth: number;
  ceiling: number | null;
}

/** The facts the ceiling decides on, for status reads and the dispatch-time re-check. Null without a DB. */
export async function readHostedCeilingState(orgSlug: string, now = new Date()): Promise<HostedCeilingState | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true, plan: true, scanCredits: true } });
  if (!org) return { orgExists: false, plan: "free", unlimited: false, balance: 0, spentThisMonth: 0, ceiling: 0 };
  const plan = org.plan ?? "free";
  return {
    orgExists: true,
    plan,
    unlimited: isUnlimitedPlan(plan),
    balance: org.scanCredits ?? 0,
    spentThisMonth: await spentThisMonth(prisma, org.id, now),
    ceiling: hostedMonthlyCeiling(plan, selfHosted()),
  };
}

export type HostedReservation =
  | { ok: true; reservationId: string; charged: number }
  | { ok: false; block: HostedChargeBlock | "unknown-org" };

/**
 * Reserve the credits for arming `lanes` hosted lanes, all-or-nothing, and append the ledger row.
 *
 * `charged` is what was actually debited (0 on an unlimited plan), and is exactly what
 * `refundHostedReservation` gives back if the run then fails to be written.
 */
export async function reserveHostedRunCredits(args: { orgSlug: string; lanes: number; actor?: string | null; now?: Date }): Promise<HostedReservation> {
  const reservationId = randomUUID();
  // Without a database no run can be written either (`startHostedRun` refuses), so nothing is spent.
  if (!isDbConfigured()) return { ok: true, reservationId, charged: 0 };
  const prisma = getPrisma();
  const slug = args.orgSlug.toLowerCase();
  const now = args.now ?? new Date();
  const externalId = `hosted:${reservationId}`;
  try {
    return await withRetry(() =>
      prisma.$transaction(async (tx): Promise<HostedReservation> => {
        const org = await tx.organization.findUnique({ where: { slug }, select: { id: true, plan: true, scanCredits: true } });
        if (!org) return { ok: false, block: "unknown-org" };
        const decision = decideHostedCharge({
          lanes: args.lanes,
          unlimited: isUnlimitedPlan(org.plan),
          balance: org.scanCredits,
          spentThisMonth: await spentThisMonth(tx, org.id, now),
          ceiling: hostedMonthlyCeiling(org.plan, selfHosted()),
        });
        if (!decision.ok) return { ok: false, block: decision.block };
        if (decision.debit === 0) return { ok: true, reservationId, charged: 0 };
        const dec = await tx.organization.updateMany({
          where: { id: org.id, scanCredits: { gte: decision.debit } },
          data: { scanCredits: { decrement: decision.debit } },
        });
        if (dec.count === 0) {
          // Out of credits after all, OR a prior acked-lost attempt of THIS reservation committed.
          const prior = await tx.creditLedger.findUnique({ where: { externalId }, select: { id: true } }).catch(() => null);
          return prior ? { ok: true, reservationId, charged: decision.debit } : { ok: false, block: "no-credit" };
        }
        const after = await tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: { scanCredits: true } });
        await tx.creditLedger.create({
          data: {
            orgId: org.id,
            delta: -decision.debit,
            balanceAfter: after.scanCredits,
            reason: CREDIT_REASON.HOSTED_RUN,
            actor: args.actor ?? null,
            externalId,
          },
        });
        return { ok: true, reservationId, charged: decision.debit };
      }),
    );
  } catch (err) {
    // A retry lost to the unique externalId: the winning attempt already debited exactly once.
    if (isP2002Error(err)) {
      const row = await prisma.creditLedger.findUnique({ where: { externalId }, select: { delta: true } }).catch(() => null);
      if (row) return { ok: true, reservationId, charged: -row.delta };
    }
    throw err;
  }
}

/** Give back a reservation whose run was never written. Idempotent on the reservation id. */
export async function refundHostedReservation(args: { orgSlug: string; reservationId: string; charged: number }): Promise<void> {
  if (args.charged <= 0) return;
  await grantCredits(args.orgSlug, args.charged, {
    reason: CREDIT_REASON.REFUND,
    actor: "system",
    externalId: `hosted-refund:${args.reservationId}`,
  });
}
