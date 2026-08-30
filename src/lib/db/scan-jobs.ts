// The durable fleet scan QUEUE (moonshot #10, lane W3-L).
//
// Two speeds share one queue, distinguished by `lane`:
//   • "rescore" — a full LLM scan. Costs a credit, minutes of wall clock, and writes a Scan row.
//   • "probe"   — a GitHub-API-only re-observation of deterministic controls. Free on every plan,
//                 ~3 REST calls, and NEVER writes a score.
//
// WHY A TABLE AND NOT A MAP. Before this module the fleet had two incompatible claims: the cron's
// DB-serialized `nextScanAt` lease (cross-instance safe, but only expressible for a repo that is DUE
// and already has a Repository row) and a module-global `Map` in org-watch.ts, self-documented as
// "NOT a cross-instance distributed lock". On a serverless deploy the Map is per-instance, so two
// tabs routed to two instances both reserved a credit and both ran real inference for the same repo.
// A row in this table is the claim: `claimJob` is a conditional `updateMany`, so the DB serializes it
// exactly like `claimRescan` does, on ANY repo — due or not, Repository row or not.
//
// Also: truncation stops being data loss. A fleet run that hits its 300s ceiling leaves the remainder
// as `queued` rows, and the next cron pass finishes exactly those.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

export type ScanLane = "rescore" | "probe";
export type ScanJobState = "queued" | "claimed" | "done" | "failed" | "skipped";

/** How long a claim holds a job before {@link reapExpiredLeases} returns it to the queue. Matches the
 *  autoscan claim lease: longer than any real single-repo scan, short enough that a process-killed
 *  worker self-heals within one cron cadence rather than stranding the repo. */
export const JOB_LEASE_MS = 15 * 60_000;

/** A job that has failed this many claims is settled `failed` instead of re-queued — nothing retries
 *  forever, and a permanently-broken repo cannot occupy a lane on every pass. */
export const MAX_JOB_ATTEMPTS = 5;

/** Priority floor per reason class. Higher runs first within a lane. */
export const JOB_PRIORITY = { manual: 10, webhook: 5, cadence: 0 } as const;

/**
 * One queue row on the wire. Every timestamp is a `string` (AGENTS.md wire-safe rule): Prisma hands
 * back `Date`, `NextResponse.json` sends ISO strings, so the type declares what a client actually
 * receives and {@link toRow} does the `.toISOString()` server-side.
 */
export interface ScanJobRow {
  id: string;
  orgId: string;
  repoId: string | null;
  repoFullName: string;
  lane: ScanLane;
  reason: string;
  state: ScanJobState;
  priority: number;
  runId: string | null;
  idempotencyKey: string;
  notBefore: string;
  claimedAt: string | null;
  claimedBy: string | null;
  leaseUntil: string | null;
  attempts: number;
  /** True while an overflow credit is held BY THIS ROW. The single record of the reservation — the
   *  worker reads it to decide a refund, and {@link settleJob} is the only path that clears it. */
  creditCharged: boolean;
  resultJson: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
}

export interface EnqueueInput {
  orgSlug: string;
  repoFullName: string;
  lane: ScanLane;
  reason: string;
  /** Idempotency bucket: the GitHub delivery id for a webhook job, the runId for an interactive or
   *  import job, the ISO date of `notBefore` for a cadence job. Defaults to the ISO date. */
  bucket?: string;
  priority?: number;
  runId?: string | null;
  repoId?: string | null;
  notBefore?: Date;
}

export interface JobOutcome {
  state: Extract<ScanJobState, "done" | "failed" | "skipped">;
  error?: string | null;
  /** Structured outcome. ABSENT (null column), never `{}`, when the job produced nothing — an empty
   *  object would read as "we looked and found nothing", which is not the same fact. */
  result?: unknown;
  /** Pass true when the caller has already refunded the credit this row held, so the row stops
   *  claiming to hold one. Omitted = leave `creditCharged` as it stands (the credit was kept). */
  creditRefunded?: boolean;
}

type PrismaJob = {
  id: string;
  orgId: string;
  repoId: string | null;
  repoFullName: string;
  lane: string;
  reason: string;
  state: string;
  priority: number;
  runId: string | null;
  idempotencyKey: string;
  notBefore: Date;
  claimedAt: Date | null;
  claimedBy: string | null;
  leaseUntil: Date | null;
  attempts: number;
  creditCharged: boolean;
  resultJson: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  settledAt: Date | null;
};

function toRow(j: PrismaJob): ScanJobRow {
  return {
    id: j.id,
    orgId: j.orgId,
    repoId: j.repoId,
    repoFullName: j.repoFullName,
    lane: j.lane as ScanLane,
    reason: j.reason,
    state: j.state as ScanJobState,
    priority: j.priority,
    runId: j.runId,
    idempotencyKey: j.idempotencyKey,
    notBefore: j.notBefore.toISOString(),
    claimedAt: j.claimedAt ? j.claimedAt.toISOString() : null,
    claimedBy: j.claimedBy,
    leaseUntil: j.leaseUntil ? j.leaseUntil.toISOString() : null,
    attempts: j.attempts,
    creditCharged: j.creditCharged,
    resultJson: j.resultJson,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    settledAt: j.settledAt ? j.settledAt.toISOString() : null,
  };
}

/** The unsettled states — a row in one of these is live work nobody may duplicate. */
const UNSETTLED: ScanJobState[] = ["queued", "claimed"];

export function idempotencyKeyFor(orgId: string, repoFullName: string, lane: ScanLane, bucket: string): string {
  return `${orgId}|${repoFullName.toLowerCase()}|${lane}|${bucket}`;
}

/** The org id + (optional) Repository id behind an "owner/name" for this org. `repoId` is null when
 *  the import funnel has not created the row yet — the queue keys on the FULL NAME for exactly that
 *  reason, and the worker re-resolves the id once the row exists. */
export async function resolveRepoJobRef(
  orgSlug: string,
  repoFullName: string,
): Promise<{ orgId: string; repoId: string | null } | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return null;
  const repo = await getPrisma()
    .repository.findUnique({ where: { orgId_fullName: { orgId, fullName: repoFullName } }, select: { id: true } })
    .catch(() => null);
  return { orgId, repoId: repo?.id ?? null };
}

/**
 * Enqueue one unit of work, idempotently.
 *
 * The unique `idempotencyKey` is the whole guard: a redelivered webhook, a double-clicked "Scan all",
 * and two overlapping cron seeds all compute the SAME key and therefore cannot produce two jobs for
 * the same work. An existing row is left completely alone — including a SETTLED one, because a
 * settled row means that exact bucket's work already ran (a redelivery must not re-run it).
 */
export async function enqueueScanJob(input: EnqueueInput): Promise<{ id: string; created: boolean } | null> {
  if (!isDbConfigured()) return null;
  const ref = await resolveRepoJobRef(input.orgSlug, input.repoFullName);
  if (!ref) return null;
  const notBefore = input.notBefore ?? new Date();
  const bucket = input.bucket ?? notBefore.toISOString().slice(0, 10);
  const key = idempotencyKeyFor(ref.orgId, input.repoFullName, input.lane, bucket);
  const prisma = getPrisma();
  const data = {
    orgId: ref.orgId,
    repoId: input.repoId ?? ref.repoId,
    repoFullName: input.repoFullName,
    lane: input.lane,
    reason: input.reason,
    priority: input.priority ?? 0,
    runId: input.runId ?? null,
    idempotencyKey: key,
    notBefore,
  };
  try {
    const created = await prisma.scanJob.create({ data, select: { id: true } });
    return { id: created.id, created: true };
  } catch {
    // Unique violation (or a transient write error): fall back to the existing row. Reading it back
    // rather than assuming means a genuine failure surfaces as null instead of a phantom job id.
    const existing = await prisma.scanJob
      .findUnique({ where: { idempotencyKey: key }, select: { id: true } })
      .catch(() => null);
    return existing ? { id: existing.id, created: false } : null;
  }
}

/** Enqueue a free control probe for one repo. `deliveryId` (webhook) becomes the idempotency bucket,
 *  so GitHub's redelivery of the same event enqueues nothing new. */
export async function enqueueProbeJob(
  orgSlug: string,
  fullName: string,
  reason: string,
  deliveryId?: string,
): Promise<{ id: string; created: boolean } | null> {
  return enqueueScanJob({
    orgSlug,
    repoFullName: fullName,
    lane: "probe",
    reason,
    bucket: deliveryId,
    priority: deliveryId ? JOB_PRIORITY.webhook : JOB_PRIORITY.cadence,
  });
}

/**
 * Seed the rescore lane from the autoscan schedule. Unlike the old `listDueRescans(100)` pass, this
 * enqueues EVERYTHING due: the queue, not the invocation, is now what holds the backlog, so a 900-repo
 * org seeds in one pass and drains across as many passes as it takes. Returns the number of NEW jobs.
 *
 * The bucket is the ISO date, so re-seeding within the same day is a no-op for a repo already queued.
 */
export async function enqueueDueRescans(limit?: number): Promise<number> {
  if (!isDbConfigured()) return 0;
  const { listDueRescanCandidates } = await import("@/lib/db/org-watch");
  const due = await listDueRescanCandidates(limit);
  let created = 0;
  for (const r of due) {
    const res = await enqueueScanJob({
      orgSlug: r.orgSlug,
      repoFullName: r.fullName,
      repoId: r.repoId,
      lane: "rescore",
      reason: "cadence",
      priority: JOB_PRIORITY.cadence,
    }).catch(() => null);
    if (res?.created) created += 1;
  }
  return created;
}

/**
 * Claim the highest-priority eligible job in a lane, or null when the lane is empty.
 *
 * The claim is a CONDITIONAL `updateMany` on `{ id, state: "queued" }` — the same DB-serialized
 * mechanism as `claimRescan`, so two workers on two instances cannot both win the same row: the
 * loser's update matches 0 rows. Cross-instance safe, which the deleted process-local Map was not.
 */
export async function claimJob(lane: ScanLane, workerId: string): Promise<ScanJobRow | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Look at a small window of candidates rather than one: under contention the top row is often taken
  // by another worker between the read and the update, and re-reading from scratch each time turns a
  // busy queue into a livelock.
  const candidates = (await prisma.scanJob.findMany({
    where: { lane, state: "queued", notBefore: { lte: new Date() } },
    orderBy: [{ priority: "desc" }, { notBefore: "asc" }],
    take: 10,
    select: { id: true },
  })) as { id: string }[];
  for (const c of candidates) {
    const won = await claimJobById(c.id, workerId);
    if (won) return won;
  }
  return null;
}

/**
 * Claim ONE specific queued job — the inline drain's entry point (`/api/org/scan` knows exactly which
 * jobs its own run enqueued). Returns the won row, or null when another worker already holds it.
 *
 * Two guards, in order:
 *  1. the conditional update on `state: "queued"` (the cross-instance CAS);
 *  2. a PEER check — no OTHER unsettled job for the same (org, repo, lane) may hold a live lease.
 *     Two browser tabs mint two runIds, hence two different idempotency keys, hence two legitimate
 *     rows for the same repo; without (2) both would reserve a credit and run inference for it. The
 *     winner is the OLDEST live claim (tie-broken by id), which is stable under a race: whoever wrote
 *     its claim first is visible to every later reader, so the later one always yields.
 */
export async function claimJobById(id: string, workerId: string): Promise<ScanJobRow | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const now = new Date();
  const res = await prisma.scanJob.updateMany({
    where: { id, state: "queued", notBefore: { lte: now } },
    data: {
      state: "claimed",
      claimedAt: now,
      claimedBy: workerId,
      leaseUntil: new Date(now.getTime() + JOB_LEASE_MS),
      attempts: { increment: 1 },
    },
  });
  if (res.count !== 1) return null;
  const won = (await prisma.scanJob.findUnique({ where: { id } })) as PrismaJob | null;
  if (!won) return null;
  const peers = (await prisma.scanJob.findMany({
    where: {
      orgId: won.orgId,
      repoFullName: won.repoFullName,
      lane: won.lane,
      state: "claimed",
      leaseUntil: { gt: now },
      id: { not: id },
    },
    select: { id: true, claimedAt: true },
  })) as { id: string; claimedAt: Date | null }[];
  const older = peers.some((p) => {
    const t = p.claimedAt ? p.claimedAt.getTime() : 0;
    const mine = won.claimedAt ? won.claimedAt.getTime() : 0;
    return t < mine || (t === mine && p.id < id);
  });
  if (older) {
    // Someone else is already scanning this repo. Put the row back rather than settling it: the work
    // is still owed, just not by us — the peer's lease expiry is the earliest it can usefully run.
    const peerLease = new Date(now.getTime() + JOB_LEASE_MS);
    await prisma.scanJob
      .update({
        where: { id },
        data: { state: "queued", claimedAt: null, claimedBy: null, leaseUntil: null, notBefore: peerLease },
      })
      .catch(() => {});
    return null;
  }
  return toRow(won);
}

/** Record that this job now HOLDS an overflow credit. Written BEFORE any inference, so a crash leaves
 *  the reservation attributable to a row rather than to a lost variable. */
export async function markJobCredit(id: string, charged: boolean): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().scanJob.update({ where: { id }, data: { creditCharged: charged } }).catch(() => {});
}

/** Settle a claimed job. The ONLY path that clears `creditCharged`, and the only writer of
 *  `settledAt` (the retention purge's horizon anchor). */
export async function settleJob(id: string, out: JobOutcome): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma()
    .scanJob.update({
      where: { id },
      data: {
        state: out.state,
        error: out.error ?? null,
        // Honest nulls: no result column at all when the job produced nothing.
        resultJson: out.result === undefined || out.result === null ? null : JSON.stringify(out.result),
        settledAt: new Date(),
        leaseUntil: null,
        ...(out.creditRefunded ? { creditCharged: false } : {}),
      },
    })
    .catch(() => {});
}

/**
 * Return every job whose lease expired to the queue — the head of every drain, so a process-killed
 * worker self-heals. Past {@link MAX_JOB_ATTEMPTS} the row is settled `failed` instead: nothing
 * retries forever. Returns how many rows were touched.
 */
export async function reapExpiredLeases(): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  const now = new Date();
  const requeued = await prisma.scanJob.updateMany({
    where: { state: "claimed", leaseUntil: { lt: now }, attempts: { lt: MAX_JOB_ATTEMPTS } },
    data: { state: "queued", claimedAt: null, claimedBy: null, leaseUntil: null },
  });
  const exhausted = await prisma.scanJob.updateMany({
    where: { state: "claimed", leaseUntil: { lt: now }, attempts: { gte: MAX_JOB_ATTEMPTS } },
    data: { state: "failed", error: "lease expired after max attempts", settledAt: now, leaseUntil: null },
  });
  return requeued.count + exhausted.count;
}

export interface LaneDepth {
  queued: number;
  /** Age of the OLDEST queued job, or null when the lane is empty — never 0, which would read as
   *  "nothing is waiting" when the truth is "nothing is measurable". */
  oldestAgeMs: number | null;
}

export async function queueDepth(orgSlug?: string): Promise<Record<ScanLane, LaneDepth>> {
  const empty: Record<ScanLane, LaneDepth> = {
    rescore: { queued: 0, oldestAgeMs: null },
    probe: { queued: 0, oldestAgeMs: null },
  };
  if (!isDbConfigured()) return empty;
  const prisma = getPrisma();
  let orgId: string | null = null;
  if (orgSlug) {
    orgId = await getOrgId(orgSlug).catch(() => null);
    if (!orgId) return empty;
  }
  const now = Date.now();
  for (const lane of ["rescore", "probe"] as ScanLane[]) {
    const where = { lane, state: "queued", ...(orgId ? { orgId } : {}) };
    const queued = await prisma.scanJob.count({ where }).catch(() => 0);
    const oldest = queued
      ? ((await prisma.scanJob
          .findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
          .catch(() => null)) as { createdAt: Date } | null)
      : null;
    empty[lane] = { queued, oldestAgeMs: oldest ? now - oldest.createdAt.getTime() : null };
  }
  return empty;
}

/**
 * One interactive run's jobs. GATE-THEN-CONSTRAIN: the caller gates `orgSlug`, and the resolved org id
 * is passed into the query BESIDE `runId`, so a runId belonging to another org is simply not found
 * rather than being authorized by the caller-supplied pair.
 */
export async function listJobsForRun(orgSlug: string, runId: string): Promise<ScanJobRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return [];
  const rows = (await getPrisma()
    .scanJob.findMany({ where: { orgId, runId }, orderBy: { createdAt: "asc" } })
    .catch(() => [])) as PrismaJob[];
  return rows.map(toRow);
}

/** The unsettled jobs for a set of repo full names — the Repositories tab's "queued" tag. */
export async function queuedJobsForRepos(orgId: string, fullNames: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!isDbConfigured() || fullNames.length === 0) return out;
  const rows = (await getPrisma()
    .scanJob.findMany({
      where: { orgId, state: { in: UNSETTLED }, repoFullName: { in: fullNames } },
      select: { repoFullName: true },
    })
    .catch(() => [])) as { repoFullName: string }[];
  for (const r of rows) out.add(r.repoFullName);
  return out;
}
