// The aged ledgers the nightly purge sweeps, declared ONCE as a table. The dry run and the delete
// read the same descriptor, so the number a preview shows is the number a confirmed run removes
// by construction (registry data-retention, dry-run-preview: "the preview is a mode of the
// deleter, not a second implementation that counts"). Adding a ledger is one row here; nothing in
// purgeExpiredData lists ledgers by hand.
//
// The predicates are pinned against the inline code they replaced: retention-ledgers.test.ts
// (what prisma receives, and which rows survive, including a row exactly at the cutoff) and
// retention-ledgers.table.test.ts (the descriptors themselves).

import type { Prisma } from "@prisma/client";
import { withRetry, type getPrisma } from "@/lib/db/client";
import type { PurgeCounterKey, PurgeCounters } from "./retention-counters";

type PrismaLike = ReturnType<typeof getPrisma>;
type Where = Record<string, unknown>;

/**
 * Shared DSQL-friendly paging-delete skeleton: select up to `batchSize` ids, stop on an empty page,
 * delete them (the caller's `deleteByIds` closure wraps its own withRetry + accumulation), then stop
 * when the page was short OR when a delete made no progress (the `deleted === 0` guard prevents an
 * infinite loop if a delete removes nothing). `deleteByIds` returns the count of progress-rows
 * removed for that termination check.
 */
export async function deleteInPages(
  selectIds: () => Promise<string[]>,
  deleteByIds: (ids: string[]) => Promise<number>,
  batchSize: number,
  budgetExceeded?: () => boolean,
): Promise<void> {
  for (;;) {
    // Yield BETWEEN batches when the run's wall-clock budget is spent (data-retention #1). Every
    // committed batch was its own transaction, so the partial state is safe and the next tick's
    // re-selection resumes exactly where this one left off.
    if (budgetExceeded?.()) break;
    const ids = await selectIds();
    if (ids.length === 0) break;
    const deleted = await deleteByIds(ids);
    if (deleted === 0 || ids.length < batchSize) break;
  }
}

/** One purged ledger. `where = { ...scope(orgId), ...aged(cutoff) }`; `aged` is a STRICT `lt`, so a
 *  row exactly at the cutoff is kept. `model` names the prisma delegate. */
export interface PurgeLedger {
  key: PurgeCounterKey;
  /** Aged on `Organization.retentionAuditDays`: these rows record what HAPPENED, like an AuditLog row. */
  horizon: "audit";
  model: string;
  label: string;
  scope: (orgId: string) => Where;
  aged: (cutoff: Date) => Where;
  orderBy: Where;
  /** Rows deleted BEFORE each parent batch, in the same transaction (no FK cascade under
   *  relationMode = "prisma"; a bulk deleteMany does not run the client-side Cascade emulation). */
  children?: {
    key: PurgeCounterKey;
    model: string;
    byParentIds: (ids: string[]) => Where;
    /** The child rows of every parent `parentWhere` matches - the preview count. */
    preview: (parentWhere: Where) => Where;
  };
  /** Never delete the newest row (by `orderBy`) of each group of `by`, even past the cutoff. */
  keepNewestPerPair?: { by: readonly string[]; orderBy: Where[] };
}

export const PURGE_LEDGERS: readonly PurgeLedger[] = [
  // MOONSHOT #11 - the LLM meter. One row per metered inference leg, so it grows with TRAFFIC rather
  // than with the fleet: an org whose scans all sit inside the keep-window still accumulates rows.
  {
    key: "usageEventsDeleted",
    horizon: "audit",
    model: "usageEvent",
    label: "retention.prune-usage-events",
    scope: (orgId) => ({ orgId }) satisfies Prisma.UsageEventWhereInput,
    aged: (cutoff) => ({ createdAt: { lt: cutoff } }) satisfies Prisma.UsageEventWhereInput,
    orderBy: { createdAt: "asc" },
  },
  // MOONSHOT #16 - the doctor per-check ledger. Findings go first, in the report batch's transaction.
  {
    key: "conformanceReportsDeleted",
    horizon: "audit",
    model: "conformanceReport",
    label: "retention.prune-conformance",
    scope: (orgId) => ({ orgId }) satisfies Prisma.ConformanceReportWhereInput,
    aged: (cutoff) => ({ reportedAt: { lt: cutoff } }) satisfies Prisma.ConformanceReportWhereInput,
    orderBy: { reportedAt: "asc" },
    children: {
      key: "conformanceFindingsDeleted",
      model: "conformanceFinding",
      byParentIds: (ids) => ({ reportId: { in: ids } }) satisfies Prisma.ConformanceFindingWhereInput,
      preview: (parentWhere) => ({ report: parentWhere }),
    },
  },
  // MOONSHOT #17 - the memory citation channel, grows with AGENT traffic. `OrgMemory.citedCount` is
  // deliberately left alone: it records that the memory WAS used, and decrementing it as evidence
  // ages would make a well-used memory decay into an apparently-unused one.
  {
    key: "memoryCitationsDeleted",
    horizon: "audit",
    model: "orgMemoryCitation",
    label: "retention.prune-memory-citations",
    scope: (orgId) => ({ orgId }) satisfies Prisma.OrgMemoryCitationWhereInput,
    aged: (cutoff) => ({ createdAt: { lt: cutoff } }) satisfies Prisma.OrgMemoryCitationWhereInput,
    orderBy: { createdAt: "asc" },
  },
  // MOONSHOT #1 - the control ledger, ALWAYS keeping the newest observation of every
  // (repoFullName, controlId) pair. The posture surfaces read the LATEST row per pair, so a plain
  // date sweep would delete the current standing of every control not re-observed inside the window
  // and retention would manufacture an `unmeasurable` finding. The survivor is excluded in the
  // PREDICATE (`id: { not: newest }`), so every page is deletable and the loop always progresses.
  // ControlLedgerSeal is deliberately NOT swept: a sealed day keeps its seal after its rows age out,
  // so a deleted window stays DETECTABLE rather than indistinguishable from a quiet day.
  {
    key: "controlObservationsDeleted",
    horizon: "audit",
    model: "controlObservation",
    label: "retention.prune-control-observations",
    scope: (orgId) => ({ orgId }) satisfies Prisma.ControlObservationWhereInput,
    aged: (cutoff) => ({ observedAt: { lt: cutoff } }) satisfies Prisma.ControlObservationWhereInput,
    orderBy: { observedAt: "asc" },
    // `id` breaks the tie so two rows sharing a timestamp cannot BOTH be treated as the survivor.
    keepNewestPerPair: { by: ["repoFullName", "controlId"], orderBy: [{ observedAt: "desc" }, { id: "desc" }] },
  },
];

export function ledgerWhere(d: PurgeLedger, orgId: string, cutoff: Date): Where {
  return { ...d.scope(orgId), ...d.aged(cutoff) };
}

/** The structural slice of a prisma delegate a sweep uses; `model` resolves to one by name. */
interface LedgerModel {
  findMany(args: Where): Promise<Array<{ id: string }>>;
  findFirst(args: Where): Promise<{ id: string } | null>;
  groupBy(args: Where): Promise<Array<Record<string, unknown>>>;
  count(args: Where): Promise<number>;
  deleteMany(args: Where): Promise<{ count: number }>;
}
const delegateOf = (client: unknown, model: string) => (client as Record<string, LedgerModel>)[model]!;

export interface LedgerSweepContext {
  prisma: PrismaLike;
  orgId: string;
  cutoff: Date;
  batchSize: number;
  overBudget: () => boolean;
}

/** The `where`s one ledger is swept under: one, or one per kept-newest group. */
async function sweepWheres(d: PurgeLedger, ctx: LedgerSweepContext): Promise<Where[] | AsyncIterable<Where>> {
  const keep = d.keepNewestPerPair;
  if (!keep) return [ledgerWhere(d, ctx.orgId, ctx.cutoff)];
  const model = delegateOf(ctx.prisma, d.model);
  const scope = d.scope(ctx.orgId);
  // One group per pair the org has ever observed: bounded by repos x catalogue controls.
  const groups = await model.groupBy({ by: [...keep.by], where: scope });
  return (async function* () {
    for (const g of groups) {
      if (ctx.overBudget()) return;
      const pair = Object.fromEntries(keep.by.map((f) => [f, g[f]]));
      const newest = await model.findFirst({ where: { ...scope, ...pair }, orderBy: keep.orderBy, select: { id: true } });
      yield { ...scope, ...pair, ...d.aged(ctx.cutoff), ...(newest ? { id: { not: newest.id } } : {}) };
    }
  })();
}

/**
 * Sweep one ledger in `mode`: `count` previews over the descriptor's predicate, `delete` removes the
 * same rows in retried batches. Counts land in the caller-owned `acc` AFTER EVERY COMMITTED BATCH,
 * so a throw in a later batch cannot lose what earlier batches already deleted.
 */
export async function sweepLedger(
  d: PurgeLedger,
  mode: "count" | "delete",
  ctx: LedgerSweepContext,
  acc: PurgeCounters,
): Promise<void> {
  const { prisma, batchSize, overBudget } = ctx;
  const model = delegateOf(prisma, d.model);
  const child = d.children;
  for await (const where of await sweepWheres(d, ctx)) {
    if (mode === "count") {
      acc[d.key] += await model.count({ where });
      if (child) acc[child.key] += await delegateOf(prisma, child.model).count({ where: child.preview(where) });
      continue;
    }
    await deleteInPages(
      async () => (await model.findMany({ where, orderBy: d.orderBy, take: batchSize, select: { id: true } })).map((r) => r.id),
      async (ids) => {
        const counts = child
          ? await withRetry(
              () =>
                prisma.$transaction(async (tx) => ({
                  children: (await delegateOf(tx, child.model).deleteMany({ where: child.byParentIds(ids) })).count,
                  parents: (await delegateOf(tx, d.model).deleteMany({ where: { id: { in: ids } } })).count,
                })),
              { label: d.label },
            )
          : {
              children: 0,
              parents: (await withRetry(() => model.deleteMany({ where: { id: { in: ids } } }), { label: d.label })).count,
            };
        acc[d.key] += counts.parents;
        if (child) acc[child.key] += counts.children;
        return counts.parents;
      },
      batchSize,
      overBudget,
    );
  }
}
