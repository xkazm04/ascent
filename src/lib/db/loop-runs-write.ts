// The WRITE half of the loop-run store: create a run, patch a run or lane, append a bounded log
// line, and reconcile the runs a dead process left behind.
//
// Import from the `@/lib/db/loop-runs` barrel; this module is an implementation split.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import {
  LOOP_CONCURRENCY_CAP,
  LOOP_DEFAULT_CONCURRENCY,
  LOOP_MAX_CYCLES_CAP,
  boundLog,
  toLaneRecord,
  toRunRecord,
  type LoopLanePhase,
  type LoopLaneRecord,
  type LoopRunPhase,
  type LoopRunRecord,
} from "@/lib/db/loop-runs-types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

// ── writes ───────────────────────────────────────────────────────────────────────────────────────

export interface CreateLoopRunInput {
  orgSlug: string;
  repos: string[];
  concurrency?: number;
  maxCycles?: number;
  curated?: boolean;
  createdBy?: string | null;
  /** Defaults to "running" — `start` arms a run; "curating" is for a run parked for hand-editing. */
  phase?: LoopRunPhase;
}

export async function createLoopRun(input: CreateLoopRunInput): Promise<LoopRunRecord | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(input.orgSlug);
  if (!org) return null;
  const row = await getPrisma().loopRun.create({
    data: {
      orgId: org.id,
      createdBy: input.createdBy ?? null,
      phase: input.phase ?? "running",
      reposJson: JSON.stringify(input.repos),
      concurrency: clamp(input.concurrency ?? LOOP_DEFAULT_CONCURRENCY, 1, LOOP_CONCURRENCY_CAP),
      maxCycles: clamp(input.maxCycles ?? 3, 1, LOOP_MAX_CYCLES_CAP),
      curated: input.curated === true,
    },
  });
  return toRunRecord(row);
}

export interface LoopRunPatch {
  phase?: LoopRunPhase;
  cycle?: number;
  error?: string | null;
  endedAt?: Date | null;
}

export async function updateLoopRun(id: string, patch: LoopRunPatch): Promise<LoopRunRecord | null> {
  if (!isDbConfigured()) return null;
  const row = await getPrisma()
    .loopRun.update({ where: { id }, data: patch })
    .catch(() => null);
  return row ? toRunRecord(row) : null;
}

/** Get-or-create the (run, repo, cycle) lane. Idempotent so a retry re-enters the same row. */
export async function upsertLane(key: {
  runId: string;
  repoFullName: string;
  cycle: number;
}): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const existing = await prisma.loopRunLane.findFirst({ where: key });
  if (existing) return toLaneRecord(existing);
  const row = await prisma.loopRunLane.create({ data: { ...key, phase: "queued" } });
  return toLaneRecord(row);
}

export interface LoopLanePatch {
  phase?: LoopLanePhase;
  branch?: string | null;
  batchIds?: string[];
  closedIds?: string[];
  commits?: number;
  beforeScanId?: string | null;
  afterScanId?: string | null;
  stage?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
}

export async function updateLane(id: string, patch: LoopLanePatch): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  const { batchIds, closedIds, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (batchIds) data.batchIdsJson = JSON.stringify(batchIds);
  if (closedIds) data.closedIdsJson = JSON.stringify(closedIds);
  const row = await getPrisma()
    .loopRunLane.update({ where: { id }, data })
    .catch(() => null);
  return row ? toLaneRecord(row) : null;
}

/**
 * Append one timestamped line to a lane's log, bounded to LANE_LOG_LINES.
 *
 * Read-modify-write rather than a SQL string append: the log is bounded, and the bound has to be
 * applied somewhere. Lanes are single-writer by construction (one driver task owns one lane), so
 * there is no interleaving to lose.
 */
export async function appendLaneLog(id: string, line: string): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const row = await prisma.loopRunLane.findUnique({ where: { id }, select: { log: true } }).catch(() => null);
  if (!row) return;
  const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`;
  const next = boundLog([...(row.log ? row.log.split("\n") : []), stamped]).join("\n");
  await prisma.loopRunLane.update({ where: { id }, data: { log: next } }).catch(() => null);
}

/**
 * Reconcile `running` rows left behind by a process that died. The engine's live handles only ever
 * exist in the process that started a run, so a `running` row this process does not own cannot be
 * resumed — mark it stopped, with a note, instead of leaving a job that looks alive forever.
 *
 * @param orgSlug scope to one org; omit to sweep every org (the boot sweep).
 * @returns how many runs were reconciled.
 */
export async function markStaleRunsStopped(orgSlug?: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  let orgId: string | undefined;
  if (orgSlug) {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return 0;
    orgId = org.id;
  }
  const where = { phase: "running", ...(orgId ? { orgId } : {}) };
  const stale = await prisma.loopRun.findMany({ where, select: { id: true } }).catch(() => []);
  if (stale.length === 0) return 0;
  const ids = stale.map((r) => r.id);
  await prisma.loopRun.updateMany({
    where: { id: { in: ids } },
    data: {
      phase: "stopped",
      endedAt: new Date(),
      error: "Interrupted — the server restarted while this run was in flight.",
    },
  });
  // In-flight lanes die with the process too; leaving them "dispatching" would spin forever.
  await prisma.loopRunLane
    .updateMany({
      where: { runId: { in: ids }, phase: { in: ["queued", "dispatching", "rescanning"] } },
      data: { phase: "error", error: "Interrupted by a server restart.", endedAt: new Date(), stage: null },
    })
    .catch(() => null);
  return ids.length;
}

