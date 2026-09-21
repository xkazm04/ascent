// The WRITE half of the loop-run store: create a run, patch a run or lane, append a bounded log
// line — and, re-exported from loop-runs-stale.ts, reconcile the runs a dead process left behind.
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
  type LaneDiffStat,
  type ProposedBatch,
  type VerifyMode,
  type VerifyRung,
  type VerifyVerdict,
} from "@/lib/db/loop-runs-types";

import type { LaneBriefProvenance } from "@/lib/org/lane-brief";
import type { LaneReport } from "@/lib/local/lane-report";
import type { LaneActivity } from "@/lib/local/runner-types";
import { serializeArms, type Arm, type ArmPolicy } from "@/lib/local/arm";

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
  /** THE THROUGHPUT + GUARD DIALS, already validated by the route (`run-limits.ts`). `null`/omitted is
   *  recorded as null, which reads back as the deployment default — byte-identical to every run armed
   *  before these columns existed. Nothing here is clamped: a normalizer that refused the value has
   *  already turned it into a 400, so an out-of-band figure never reaches the store. */
  batchSize?: number | null;
  agentTimeoutMs?: number | null;
  verifyMode?: VerifyMode | null;
  verifyTimeoutMs?: number | null;
  /** The drive that dispatched this run; omitted/null for a manual run. */
  driveId?: string | null;
  /** `on` = every lane plans first (a runner run, or an operator's plan-mode run). Omitted = off. */
  planMode?: "on" | null;
  /** THE ARMS this run races (src/lib/local/arm.ts), already validated by `normalizeArmSet`. Omitted
   *  records NULL, not `[]` — a run armed without arms is a pre-arms run, and `[]` would read as
   *  "armed with nothing". */
  arms?: Arm[] | null;
  /** `single` | `compare`. Omitted = null, which leaves `modelPolicy` the only reading. */
  armPolicy?: ArmPolicy | null;
  /** The transport probe taken at arm time, already serialized (WP4 owns its shape). */
  probeJson?: string | null;
  /** Defaults to "running" — `start` arms a run; "curating" is for a run parked for hand-editing. */
  phase?: LoopRunPhase;
}

/**
 * The org's next STABLE run number. Safe without a lock because an org holds one run slot at a time
 * (the engine refuses a second concurrent run), and a remote run is armed from the same single path.
 * An org whose legacy rows were never backfilled counts them, so the first new number continues the
 * history rather than restarting it at #1.
 */
async function nextRunSeq(orgId: string): Promise<number | null> {
  const prisma = getPrisma();
  const top = await prisma.loopRun
    .findFirst({ where: { orgId, seq: { not: null } }, orderBy: { seq: "desc" }, select: { seq: true } })
    .catch(() => null);
  if (top?.seq != null) return top.seq + 1;
  const count = await prisma.loopRun.count({ where: { orgId } }).catch(() => null);
  return count == null ? null : count + 1;
}

export async function createLoopRun(input: CreateLoopRunInput): Promise<LoopRunRecord | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(input.orgSlug);
  if (!org) return null;
  const seq = await nextRunSeq(org.id);
  const row = await getPrisma().loopRun.create({
    data: {
      orgId: org.id,
      seq,
      driveId: input.driveId ?? null,
      planMode: input.planMode === "on" ? "on" : null,
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
      batchSize: input.batchSize ?? null,
      agentTimeoutMs: input.agentTimeoutMs ?? null,
      verifyMode: input.verifyMode ?? null,
      verifyTimeoutMs: input.verifyTimeoutMs ?? null,
      // Serialized only when there ARE arms: an empty list would be written as "[]", which the read
      // side cannot tell from a run armed with nothing at all.
      armsJson: input.arms && input.arms.length > 0 ? serializeArms(input.arms) : null,
      armPolicy: input.armPolicy ?? null,
      probeJson: input.probeJson ?? null,
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
  /** WIDENS THE KEY the same way `model` does, and more exactly: two arms of a `compare` run can
   *  execute the SAME model through different transports (or plan differently), so the model alone
   *  would resolve both to one row. The arm id is what makes them two samples. */
  armId?: string | null;
  /** Stamped on CREATE so the row knows its transport from the moment it exists. */
  transport?: string | null;
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
  const { model, armId, transport, abPairKey, executor, batchIds, ...base } = key;
  // The arm id is the STRONGER discriminator and wins when present; `model` remains the key an `ab`
  // run has always been resolved by, so a legacy run re-enters exactly the row it always did.
  const where = armId ? { ...base, armId } : model ? { ...base, model } : base;
  const existing = await prisma.loopRunLane.findFirst({ where });
  if (existing) return toLaneRecord(existing);
  const row = await prisma.loopRunLane.create({
    data: {
      ...base,
      phase: "queued",
      ...(model ? { model } : {}),
      ...(armId ? { armId } : {}),
      ...(transport ? { transport } : {}),
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

  // ── ARMS (spark local-model-lanes). `null` is a legitimate value on each: it means "this lane did
  // not record one", which for `planModel` is an absence (the lane never planned) and for `transport`
  // is a lane older than transports — never a default.
  transport?: string | null;
  armId?: string | null;
  planModel?: string | null;
  /** Why the lane is `void`. Written in the SAME patch that sets `phase: "void"`, so a void is never
   *  a phase without its reason. */
  voidReason?: string | null;

  // ── WHAT THE PLANNING SESSION SPENT (WP9). Written in the same patch as the executing session's
  // figures, which these do NOT replace: the lane ran two sessions and now records both. `null` is a
  // legitimate value on each and means "no planning session reported this" — an absence, never 0.
  planInputTokens?: number | null;
  planOutputTokens?: number | null;
  planCacheReadTokens?: number | null;
  planTurns?: number | null;
  planDurationMs?: number | null;

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

  // ── THE A/B DEGRADATION GUARD. Written in the same patch that ends the lane, so a lane that dies
  // afterwards still carries its verdict. `null` is a legitimate value and means "no verdict" (the
  // guard was off, or this lane predates it) — never `skipped`, which is a verdict of its own.
  verifyVerdict?: VerifyVerdict | null;
  verifyCommand?: string | null;
  verifyNote?: string | null;
  /** WHICH RUNG the command was — `primary`, or `typecheck` / `lint` when the guard narrowed because
   *  the declared command could not establish a baseline in the worktree. */
  verifyRung?: VerifyRung | null;

  // ── THE STANDING RUNNER + THE THEATER (spark theater-upgrade, 2026-09-18).
  planId?: string | null;
  heartbeatAt?: Date | null;
  stageAt?: Date | null;
  deadlineAt?: Date | null;
  /** The bounded activity tail — serialized into `activityJson`. */
  activity?: LaneActivity[];
  /** The batch as offered — serialized into `proposedJson`. */
  proposed?: ProposedBatch;
  /** The worktree poll's measurement — serialized into `diffStatJson`. */
  diffStat?: LaneDiffStat;
  landedAt?: Date | null;
}

/**
 * Patch one lane.
 *
 * THE `stageAt` CHOKEPOINT (spark theater-upgrade). Every write that moves the lane's `phase` or
 * `stage` — an explicit `stage: null` included, because leaving a stage is entering the next one —
 * stamps `stageAt` with now, unless the patch names its own. Here rather than at the call sites
 * because there are dozens of them in the lane and one of them would be forgotten: this way every
 * lane stage has a start time and "Checking the build · 4m" is measured, not guessed.
 */
export async function updateLane(id: string, patch: LoopLanePatch): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  const { batchIds, closedIds, deliverables, brief, report, activity, proposed, diffStat, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if ((patch.phase !== undefined || patch.stage !== undefined) && patch.stageAt === undefined) data.stageAt = new Date();
  if (activity) data.activityJson = JSON.stringify(activity);
  if (proposed) data.proposedJson = JSON.stringify(proposed);
  if (diffStat) data.diffStatJson = JSON.stringify(diffStat);
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

// The stale-run sweep lives in its own module; re-exported so every import path is unchanged.
export { markStaleRunsStopped } from "./loop-runs-stale";
