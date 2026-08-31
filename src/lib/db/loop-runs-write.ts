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
  parseDeliverables,
  toLaneRecord,
  toRunRecord,
  type DeliverableReview,
  type LaneDeliverable,
  type LoopLanePhase,
  type LoopLaneRecord,
  type LoopModelPolicy,
  type LoopDelivery,
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
  /** How the run's lane branches are delivered — `branch` (the default and what every run before this
   *  did), `land` or `pr`. Already validated by the route; `null` is recorded as null, which reads
   *  back as `branch`. */
  delivery?: LoopDelivery | null;
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
      delivery: input.delivery ?? null,
    },
  });
  return toRunRecord(row);
}

/**
 * THE `curating` → `running` TRANSITION, and the only thing that performs it (moonshot #3).
 *
 * A remote run is armed and then waits: its lanes name their repos and their proposed batches, and
 * nothing is in flight until an agent somewhere claims into one. This is called from the claim tool
 * on a successful claim and moves that repo's queued lane to `dispatching`, stamping who took it and
 * when their lease lapses; the run itself flips to `running` on the first such claim.
 *
 * BEST-EFFORT BY CONTRACT. A claim that succeeded must never be undone because the cockpit's row
 * could not be updated — the ledger is the source of truth about who holds a row, and this is the
 * display of it. Every failure path returns false and the claim stands.
 */
export async function attachRemoteClaim(args: {
  orgSlug: string;
  repoFullName: string;
  claimedBy: string;
  leaseUntil: Date | null;
}): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getOrgBySlug(args.orgSlug);
  if (!org) return false;
  const prisma = getPrisma();
  const run = await prisma.loopRun
    .findFirst({ where: { orgId: org.id, phase: { in: ["curating", "running"] } }, orderBy: { createdAt: "desc" } })
    .catch(() => null);
  if (!run) return false;
  const lane = await prisma.loopRunLane
    .findFirst({ where: { runId: run.id, repoFullName: args.repoFullName, executor: "remote-agent" } })
    .catch(() => null);
  if (!lane) return false;
  await prisma.loopRunLane
    .update({
      where: { id: lane.id },
      data: {
        // `queued` is the only phase a claim advances. A lane already `dispatching` gets its claimant
        // and lease refreshed (the same agent re-claiming, or a second one after an expiry) without
        // being dragged backwards through the rail, and a `done` lane is left alone entirely.
        ...(lane.phase === "queued" ? { phase: "dispatching", startedAt: new Date() } : {}),
        claimedBy: args.claimedBy,
        leaseUntil: args.leaseUntil,
      },
    })
    .catch(() => null);
  if (run.phase === "curating") {
    await prisma.loopRun.update({ where: { id: run.id }, data: { phase: "running" } }).catch(() => null);
  }
  return true;
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
  /** #3 — set on CREATE only, and only on a remote lane. An existing row's executor is never
   *  rewritten by an upsert: which worker a lane belongs to is decided when the run is armed. */
  executor?: string;
  /** #3 — the batch a remote lane is armed with. There is no local process to pick one later, so a
   *  remote lane carries its proposed batch from the moment it exists. */
  batchIds?: string[];
}): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const { model, abPairKey, executor, batchIds, ...base } = key;
  const existing = await prisma.loopRunLane.findFirst({ where: model ? { ...base, model } : base });
  if (existing) return toLaneRecord(existing);
  const row = await prisma.loopRunLane.create({
    data: {
      ...base,
      phase: "queued",
      ...(model ? { model } : {}),
      ...(abPairKey ? { abPairKey } : {}),
      ...(executor ? { executor } : {}),
      ...(batchIds ? { batchIdsJson: JSON.stringify(batchIds) } : {}),
    },
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
  /** The lane's headlines (lane-deliverables.ts). Serialized into the nullable `deliverablesJson`. */
  deliverables?: LaneDeliverable[];

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

  // ── MOONSHOT #3 — who is doing this lane's work, and under what lease. All three are writable
  // because a remote lane's claimant changes DURING the lane: `claim_followups` is what moves it out
  // of `queued`, and the lease it stamps is what the cockpit counts down.
  executor?: string;
  claimedBy?: string | null;
  leaseUntil?: Date | null;
}

export async function updateLane(id: string, patch: LoopLanePatch): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  const { batchIds, closedIds, deliverables, brief, report, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (batchIds) data.batchIdsJson = JSON.stringify(batchIds);
  if (closedIds) data.closedIdsJson = JSON.stringify(closedIds);
  if (deliverables) data.deliverablesJson = JSON.stringify(deliverables);
  if (brief) data.briefJson = JSON.stringify(brief);
  if (report) data.reportJson = JSON.stringify(report);
  const row = await getPrisma()
    .loopRunLane.update({ where: { id }, data })
    .catch(() => null);
  return row ? toLaneRecord(row) : null;
}

/**
 * Record an owner's ruling on ONE deliverable row of a lane — the persistence half of the review
 * gate (the loop proposes, the human disposes).
 *
 * `cover` is the row's key: its first `covers` id, or its headline when it covers nothing. When the
 * key matches a persisted entry (by covered id, then by headline), the entry's widened `review`
 * field is set in place. When it matches nothing — a backfilled derivation the row was never
 * persisted for, or a `proposed` batch item the client synthesized — a REVIEW MARKER is appended
 * (`{headline: cover, covers: [cover], kind: "noted", review}`; see `isReviewMarker`): the read
 * side re-derives the row and attaches the ruling by key, and no surface renders the marker itself.
 *
 * Read-modify-write on the same single-writer-per-lane grounds as `appendLaneLog` — and reviews
 * arrive from one owner's clicks, not from the engine.
 */
export async function reviewDeliverable(
  laneId: string,
  cover: string,
  review: DeliverableReview,
): Promise<LaneDeliverable[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const row = await prisma.loopRunLane.findUnique({ where: { id: laneId }, select: { deliverablesJson: true } }).catch(() => null);
  if (!row) return null;
  const list = parseDeliverables(row.deliverablesJson);
  const hit = list.find((d) => d.covers.includes(cover)) ?? list.find((d) => d.headline === cover);
  if (hit) hit.review = review;
  else list.push({ headline: cover, dimId: null, kind: "noted", covers: [cover], evidence: null, review });
  const ok = await prisma.loopRunLane
    .update({ where: { id: laneId }, data: { deliverablesJson: JSON.stringify(list) } })
    .catch(() => null);
  return ok ? list : null;
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

