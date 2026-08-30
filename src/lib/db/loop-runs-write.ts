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
  type LoopModelPolicy,
  type LoopRunPhase,
  type LoopRunRecord,
  type LoopTarget,
} from "@/lib/db/loop-runs-types";

import type { LaneBriefProvenance } from "@/lib/org/lane-brief";
import type { LaneReport } from "@/lib/local/lane-report";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

// ── writes ───────────────────────────────────────────────────────────────────────────────────────

export interface CreateLoopRunInput {
  orgSlug: string;
  repos: string[];
  /** The repos WITH their armed lane kinds. When given, this is what `reposJson` records (the repo
   *  order must match `repos`); omit it and the run is recorded as all-`backlog`, which is what every
   *  row written before lane kinds existed means. */
  targets?: LoopTarget[];
  concurrency?: number;
  maxCycles?: number;
  curated?: boolean;
  createdBy?: string | null;
  /** RESOLVED agent configuration (see resolveAgentConfig) — what the sessions will actually run as. */
  model?: string | null;
  effort?: string | null;
  /** How the run spends models. Defaults to `single`, which is what every run before #27 was. */
  modelPolicy?: LoopModelPolicy;
  /** The models the run is armed with, IN ORDER — one for `single`, the two arms for `ab`. Recorded
   *  so the price list can attribute a lane to an arm long after the run ended. */
  models?: string[];
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
      reposJson: JSON.stringify(input.targets ?? input.repos),
      concurrency: clamp(input.concurrency ?? LOOP_DEFAULT_CONCURRENCY, 1, LOOP_CONCURRENCY_CAP),
      maxCycles: clamp(input.maxCycles ?? 3, 1, LOOP_MAX_CYCLES_CAP),
      curated: input.curated === true,
      model: input.model ?? null,
      effort: input.effort ?? null,
      modelPolicy: input.modelPolicy ?? "single",
      modelsJson: JSON.stringify(input.models ?? (input.model ? [input.model] : [])),
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

/**
 * Get-or-create the (run, repo, cycle) lane. Idempotent so a retry re-enters the same row.
 *
 * `model` WIDENS THE KEY, and it has to: an `ab` run works one repo with two lanes in one cycle, and
 * on the three-part key both arms would resolve to the same row — the second arm silently
 * overwriting the first's cost, branch and result. It is part of the CREATE data too, so the row
 * knows which arm it is from the moment it exists rather than only after its session returns.
 * Omitted (a `single` run) the behaviour is exactly what it always was.
 */
export async function upsertLane(key: {
  runId: string;
  repoFullName: string;
  cycle: number;
  model?: string | null;
  abPairKey?: string | null;
}): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const { model, abPairKey, ...base } = key;
  const existing = await prisma.loopRunLane.findFirst({ where: model ? { ...base, model } : base });
  if (existing) return toLaneRecord(existing);
  const row = await prisma.loopRunLane.create({
    data: { ...base, phase: "queued", ...(model ? { model } : {}), ...(abPairKey ? { abPairKey } : {}) },
  });
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

  // ── MOONSHOT #27. Written in the SAME patch that records `commits`, so a lane that dies later
  // still carries what its session cost. `null` is a legitimate value on every one of them and means
  // "the CLI reported nothing" — the patch writes it rather than skipping the field, because a lane
  // whose second attempt reported nothing must not keep the first attempt's figure.
  model?: string | null;
  costSource?: string | null;
  costMicros?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  turns?: number | null;
  agentDurationMs?: number | null;
  agentSessionId?: string | null;
  abPairKey?: string | null;

  // ── MOONSHOT #25. Objects rather than pre-serialized strings: the JSON-in-TEXT encoding is the
  // store's business, and a caller that had to remember to stringify is a caller that will one day
  // write a `[object Object]` column.
  brief?: LaneBriefProvenance;
  report?: LaneReport;

  // ── MOONSHOT #26 — the batch's dominant dimension, stamped at dispatch, and the lane's PR,
  // denormalized so the cockpit renders the link without a join.
  dimId?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
}

export async function updateLane(id: string, patch: LoopLanePatch): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  const { batchIds, closedIds, brief, report, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (batchIds) data.batchIdsJson = JSON.stringify(batchIds);
  if (closedIds) data.closedIdsJson = JSON.stringify(closedIds);
  if (brief) data.briefJson = JSON.stringify(brief);
  if (report) data.reportJson = JSON.stringify(report);
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
export async function markStaleRunsStopped(
  orgSlug?: string,
  /**
   * Which run ids THIS process is still driving. Without it every `running` row is treated as
   * orphaned — correct for the boot sweep (a fresh process drives nothing) and wrong for every
   * later call: the loop route reconciles on each GET, so with no predicate a page load during a
   * run stopped the run it was rendering (found 2026-08-26 when the drive door's first run died
   * 35 seconds into cycle 1 on the very poll that was watching it). Pass the engine's
   * `isLoopRunLive`; it is backed by a process-wide registry, so every route chunk agrees.
   */
  isLive: (id: string) => boolean = () => false,
): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  let orgId: string | undefined;
  if (orgSlug) {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return 0;
    orgId = org.id;
  }
  const where = { phase: "running", ...(orgId ? { orgId } : {}) };
  const running = await prisma.loopRun.findMany({ where, select: { id: true } }).catch(() => []);
  const stale = running.filter((r) => !isLive(r.id));
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
  // A dead run's CLAIMS die with it too. Its lanes marked backlog rows in_progress before the agent
  // ran; with nobody left to rescan, those rows are zombies — never re-dispatched (openBatch takes
  // `open` only) and kept in_progress by the movement-gated resolve rule. Drive #1 (2026-08-26) left
  // ten of eleven rows claimed this way and the next drive found "no open follow-ups" on a fleet with
  // 350 points of debt. Release them, with a ledger event per row saying why.
  try {
    const lanes = await prisma.loopRunLane.findMany({
      where: { runId: { in: ids }, phase: { in: ["queued", "dispatching", "rescanning"] } },
      select: { batchIdsJson: true },
    });
    const recIds = [
      ...new Set(
        lanes.flatMap((l) => {
          try {
            const parsed: unknown = JSON.parse(l.batchIdsJson || "[]");
            return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
          } catch {
            return [];
          }
        }),
      ),
    ];
    if (recIds.length > 0) {
      const claimed = await prisma.recommendation.findMany({
        where: { id: { in: recIds }, status: "in_progress" },
        select: { id: true },
      });
      if (claimed.length > 0) {
        await prisma.recommendation.updateMany({
          where: { id: { in: claimed.map((r) => r.id) } },
          data: { status: "open" },
        });
        await prisma.recommendationEvent.createMany({
          data: claimed.map((r) => ({
            recommendationId: r.id,
            actor: "autopilot",
            kind: "status",
            fromValue: "in_progress",
            toValue: "open",
            note: "Released: the loop run that claimed this item was interrupted before its rescan could adjudicate.",
          })),
        });
      }
    }
  } catch {
    // Best-effort: a failed release leaves rows a human can still reopen from the ledger.
  }
  // In-flight lanes die with the process too; leaving them "dispatching" would spin forever.
  await prisma.loopRunLane
    .updateMany({
      where: { runId: { in: ids }, phase: { in: ["queued", "dispatching", "rescanning"] } },
      data: { phase: "error", error: "Interrupted by a server restart.", endedAt: new Date(), stage: null },
    })
    .catch(() => null);
  return ids.length;
}

