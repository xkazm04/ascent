// Replay receipts for the OTLP push path (scan-sweep challenge 2026-10-22c, providers-0).
//
// OTLP delivery is at-least-once and the push path stores delta counters by INCREMENTING the day
// bucket (recordUsage mode "add") and the session row (recordAgentSessions). AiUsageRecord's day key
// absorbs many exports by design, so it cannot reject a repeated one; the uniqueness that can lives
// HERE: one OtlpPointReceipt per (orgId, sink, pointKey), pointKey being the series + interval
// identity of one datapoint (src/lib/integrations/otlp-point-key.ts).
//
// Admission is INSERT ... ON CONFLICT DO NOTHING RETURNING inside an interactive transaction, and the
// sink's writes run in the SAME transaction, so a mid-batch failure rolls the claim back with the
// write and the exporter's retry stores the full value exactly once. The two sinks (usage, sessions)
// claim independently: a session-write failure never fails an ingest whose usage landed, and a
// datapoint folded into one sink is not thereby marked folded into the other.
//
// Receipts only need to outlive the exporter's retry window. They expire after a 7-day replay
// horizon and are swept for the ingesting org in-request, a bounded delete per call, so the table's
// size is set by an org's export rate over a week, never by its age.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { AdmitPoint } from "@/lib/integrations/otlp-point-key";

export type OtlpReceiptSink = "usage" | "sessions";

/** How long a receipt is kept: far past any exporter retry, so a resend inside it is recognized. */
export const OTLP_REPLAY_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Upper bound on receipts deleted by one ingest's sweep, so the sweep never dominates a request. */
export const OTLP_RECEIPT_SWEEP_BATCH = 500;
/** Rows per claim INSERT: 3 bound parameters each, far inside Postgres' 65535-parameter ceiling. */
const CLAIM_CHUNK = 1000;

type ReceiptTx = Pick<Prisma.TransactionClient, "otlpPointReceipt">;

/** Claim `keys` for (orgId, sink). Returns the keys THIS call inserted; every other key was already admitted. */
export async function claimPoints(tx: ReceiptTx, orgId: string, sink: OtlpReceiptSink, keys: string[]): Promise<Set<string>> {
  const claimed = new Set<string>();
  const distinct = [...new Set(keys)];
  for (let i = 0; i < distinct.length; i += CLAIM_CHUNK) {
    const rows = await tx.otlpPointReceipt.createManyAndReturn({
      data: distinct.slice(i, i + CLAIM_CHUNK).map((pointKey) => ({ orgId, sink, pointKey })),
      skipDuplicates: true,
      select: { pointKey: true },
    });
    for (const r of rows) claimed.add(r.pointKey);
  }
  return claimed;
}

/** Delete up to OTLP_RECEIPT_SWEEP_BATCH of `orgId`'s receipts older than the replay horizon. */
export async function sweepExpiredReceipts(tx: ReceiptTx, orgId: string, nowMs: number): Promise<number> {
  const expired = await tx.otlpPointReceipt.findMany({
    where: { orgId, createdAt: { lt: new Date(nowMs - OTLP_REPLAY_HORIZON_MS) } },
    select: { id: true },
    take: OTLP_RECEIPT_SWEEP_BATCH,
  });
  if (expired.length === 0) return 0;
  const res = await tx.otlpPointReceipt.deleteMany({ where: { id: { in: expired.map((r) => r.id) } } });
  return res.count;
}

/**
 * Claim one sink's keys and run its write in one transaction. `write` receives the admission
 * predicate for the parser and the transaction client for the upserts. Without a database or a known
 * org there is no store to claim against, so everything is admitted and `write` runs as it always did
 * (recordUsage reports the missing database / org itself). `sweep` also expires old receipts.
 */
export async function withAdmittedPoints<T>(
  orgSlug: string,
  sink: OtlpReceiptSink,
  keys: string[],
  write: (admit: AdmitPoint, client?: Prisma.TransactionClient) => Promise<T>,
  opts: { nowMs: number; sweep?: boolean },
): Promise<T> {
  if (!isDbConfigured()) return write(null);
  const org = await getOrgBySlug(orgSlug);
  if (!org) return write(null);
  return getPrisma().$transaction(
    async (tx) => {
      if (opts.sweep) await sweepExpiredReceipts(tx, org.id, opts.nowMs);
      const admitted = await claimPoints(tx, org.id, sink, keys);
      return write((key) => admitted.has(key), tx);
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}
