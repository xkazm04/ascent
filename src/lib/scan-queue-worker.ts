// The lane-agnostic drain both crons and the interactive route call (moonshot #10, lane W3-L).
//
// One loop, two lanes. `drainLane("probe")` runs free GitHub-only observations; `drainLane("rescore")`
// runs the paid scan the cron used to inline. Everything that made the cron correct — claim before
// work, reserve before inference, refund only a PRE-inference failure, settle the cadence — moves
// here UNEDITED; the only change is where the claim lives (a `ScanJob` row instead of `nextScanAt`
// plus a process-local Map) and that the remainder of an over-budget pass survives as queued rows.

import { scanRepository } from "@/lib/scan";
import {
  advanceScheduleAfterFailure,
  advanceToFullCadence,
  getInstallationIdForOwner,
  getOrgId,
  getLastScanAttempt,
  getScanReportByCommit,
  inFailureBackoff,
  isByomActive,
  persistScanReport,
  recordScanOutcome,
  CREDIT_SKIP_ERROR,
} from "@/lib/db";
import { claimJob, claimJobById, markJobCredit, reapExpiredLeases, settleJob, type ScanJobRow, type ScanLane } from "@/lib/db/scan-jobs";
import { getInstallationToken } from "@/lib/github/app";
import { degradedRead } from "@/lib/org/degraded-read";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { probeRepository } from "@/lib/scan-probe";
import { drainUntilDeadline } from "@/lib/pool";
import { decodeImportReason, type ImportJobPolicy } from "@/lib/scan-import-policy";
import { getRepoSchedule } from "@/lib/db/org-watch";
import { isMeteredScan } from "@/lib/entitlement";
import type { ScanProgress } from "@/lib/types";

/** The reason a push-triggered rescan is enqueued under (src/lib/push-rescan.ts). A job with this
 *  reason runs the PUSH branch of {@link runRescoreJob}; every other reason is untouched by it. */
export const PUSH_JOB_REASON = "webhook:push";

/** The scan outcome a push rescan records when the provider degraded to the deterministic floor. A
 *  failed outcome on purpose: the failure backoff then covers the outage instead of every push in it. */
export const PUSH_DEGRADED_ERROR = "LLM unavailable: not persisted";

export interface DrainOptions {
  concurrency: number;
  /** Wall-clock instant after which no NEW job is claimed (see `fleetDeadlineAt`). */
  deadlineAt: number;
  /** Diagnostics only — never an authorization input. */
  workerId?: string;
  /** Restrict the drain to these jobs (the interactive route's own run). Omitted = the whole lane.
   *  The repo name rides along so a LOST claim can still be named on the wire — the skip is what the
   *  user sees, and "some repo is already being scanned" is not an answer. */
  jobs?: { id: string; repo: string }[];
  /** The org slug when the caller already knows it, so a scoped drain skips the per-job lookup. */
  orgSlug?: string;
  /** Per-repo lifecycle, for the SSE surfaces. Never throws into the drain. */
  onRepo?: (event: RepoEvent) => void;
  onScanProgress?: (fullName: string, p: ScanProgress) => void;
  now?: () => number;
}

export type RepoEvent =
  | { repo: string; stage: "start" }
  | { repo: string; stage: "done"; level: string; overall: number; posture: string; adoption: number; rigor: number }
  | { repo: string; stage: "skipped"; reason: "insufficient_credits" | "in_progress" | "no_token" }
  | { repo: string; stage: "error"; error: string; charged: boolean }
  | { repo: string; stage: "probed"; written: number; transitions: number };

export interface DrainSummary {
  claimed: number;
  done: number;
  failed: number;
  skipped: number;
  skippedForCredits: number;
  skippedNoToken: number;
  /** The wall-clock budget stopped the drain; the rest is still queued, not lost. */
  truncated: boolean;
  errors: string[];
}

const emptySummary = (): DrainSummary => ({
  claimed: 0,
  done: 0,
  failed: 0,
  skipped: 0,
  skippedForCredits: 0,
  skippedNoToken: 0,
  truncated: false,
  errors: [],
});

/** One installation token and one BYOM verdict per org per drain — concurrent lanes would otherwise
 *  race to mint the same org's token, exactly as the cron already avoided. */
class OrgContext {
  private tokens = new Map<string, string | undefined>();
  private byom = new Map<string, boolean>();
  private slugs = new Map<string, string | null>();

  async token(slug: string): Promise<string | undefined> {
    if (this.tokens.has(slug)) return this.tokens.get(slug);
    const id = await getInstallationIdForOwner(slug).catch(degradedRead("queue-worker installation lookup (token)", null));
    const tok = id ? await getInstallationToken(id).catch(degradedRead("queue-worker installation token mint", undefined)) : undefined;
    this.tokens.set(slug, tok);
    return tok;
  }

  /** True when this org HAS an installation but the token mint failed — a likely-revoked install, to
   *  be distinguished from a public org that legitimately scans tokenless. */
  async brokenInstall(slug: string): Promise<boolean> {
    const id = await getInstallationIdForOwner(slug).catch(degradedRead("queue-worker installation lookup (brokenInstall)", null));
    if (!id) return false;
    return (await this.token(slug)) === undefined;
  }

  async isByom(slug: string): Promise<boolean> {
    const hit = this.byom.get(slug);
    if (hit !== undefined) return hit;
    const v = await isByomActive(slug).catch(degradedRead("queue-worker BYOM check", false));
    this.byom.set(slug, v);
    return v;
  }

  async slugFor(orgId: string, fallback?: string): Promise<string | null> {
    if (fallback) return fallback;
    const hit = this.slugs.get(orgId);
    if (hit !== undefined) return hit;
    // getOrgId is slug → id; the reverse is only needed for an unscoped cron drain, where the job row
    // is the only thing we hold. Resolved through the same cache so it costs one query per org.
    const { getPrisma, isDbConfigured } = await import("@/lib/db/client");
    let slug: string | null = null;
    if (isDbConfigured()) {
      const row = await getPrisma().organization.findUnique({ where: { id: orgId }, select: { slug: true } })
        .catch(degradedRead("queue-worker org slug lookup", null));
      slug = row?.slug ?? null;
    }
    this.slugs.set(orgId, slug);
    return slug;
  }
}

/**
 * Drain one lane until the queue is empty or the deadline is reached.
 *
 * `reapExpiredLeases()` runs at the head, so a worker killed mid-job (a serverless process kill runs
 * no `finally`) returns its work to the queue instead of stranding it.
 */
export async function drainLane(lane: ScanLane, opts: DrainOptions): Promise<DrainSummary> {
  const summary = emptySummary();
  const workerId = opts.workerId ?? `w_${Math.random().toString(36).slice(2, 10)}`;
  await reapExpiredLeases().catch(degradedRead("queue-worker lease reap (drainLane)", 0));

  const ctx = new OrgContext();
  const pending = opts.jobs ? [...opts.jobs] : null;
  const supply = async (): Promise<ScanJobRow | null> => {
    if (pending) {
      for (;;) {
        const next = pending.shift();
        if (next === undefined) return null;
        const won = await claimJobById(next.id, workerId).catch(degradedRead("queue-worker claim by id", null));
        // A job another worker holds is not ours to run; move on rather than blocking this lane.
        if (won) return won;
        summary.skipped += 1;
        opts.onRepo?.({ repo: next.repo, stage: "skipped", reason: "in_progress" });
      }
    }
    return claimJob(lane, workerId).catch(degradedRead("queue-worker claim", null));
  };

  const { truncated } = await drainUntilDeadline(
    supply,
    opts.concurrency,
    opts.deadlineAt,
    async (job) => {
      summary.claimed += 1;
      const slug = await ctx.slugFor(job.orgId, opts.orgSlug);
      if (!slug) {
        await settleJob(job.id, { state: "skipped", error: "org not resolvable" });
        summary.skipped += 1;
        return;
      }
      if (lane === "probe") await runProbeJob(job, slug, ctx, summary, opts);
      else await runRescoreJob(job, slug, ctx, summary, opts);
    },
    opts.now,
  );
  summary.truncated = truncated;
  return summary;
}

/** Settle a cadence lease to the repo's FULL next slot. The schedule lives on the Repository row, not
 *  on the job, so it is read here — `advanceToFullCadence` keeps its exact semantics (a no-op for an
 *  off/unknown cadence), including its scanSlotAt anchoring. */
async function settleCadence(job: ScanJobRow): Promise<void> {
  if (!job.repoId) return;
  const schedule = await getRepoSchedule(job.repoId).catch(degradedRead("queue-worker schedule read (settleCadence)", null));
  if (!schedule) return;
  await advanceToFullCadence(job.repoId, schedule).catch(degradedRead("queue-worker cadence advance", undefined));
}

async function runProbeJob(job: ScanJobRow, slug: string, ctx: OrgContext, summary: DrainSummary, opts: DrainOptions): Promise<void> {
  try {
    const token = await ctx.token(slug);
    const res = await probeRepository({
      orgSlug: slug,
      fullName: job.repoFullName,
      token,
      repoId: job.repoId,
      jobId: job.id,
      now: opts.now,
    });
    // Honest nulls: a probe that wrote nothing (everything unchanged, no heartbeat due) still SETTLES
    // done — it looked, and "nothing changed" is a result. The counts say what it found.
    await settleJob(job.id, { state: "done", result: { written: res.written, transitions: res.transitions, present: res.present } });
    summary.done += 1;
    opts.onRepo?.({ repo: job.repoFullName, stage: "probed", written: res.written, transitions: res.transitions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "probe failed";
    await settleJob(job.id, { state: "failed", error: msg });
    summary.failed += 1;
    summary.errors.push(`${job.repoFullName}: ${msg}`);
  }
}

/** The GitHub credential a rescore scans with. Every non-import row (and a legacy bare `import` one)
 *  keeps the default: the org's installation token, or scanRepository's own env fallback when there is
 *  none. An import row scans with the credential its request did, and a token-less one says so
 *  EXPLICITLY, because an absent `token` alone falls back to the ambient operator PAT. */
async function scanCredential(
  policy: ImportJobPolicy | null,
  slug: string,
  ctx: OrgContext,
): Promise<{ token?: string; noAmbientToken?: true }> {
  if (!policy || policy.token === "install") return { token: await ctx.token(slug) };
  if (policy.token === "ambient") return {};
  return { noAmbientToken: true };
}

/**
 * The paid lane. Byte-for-byte the cron's money policy, moved not rewritten:
 *   • a broken installation token backs off 6h rather than skipping a whole cadence;
 *   • the credit is reserved BEFORE inference and recorded on the JOB ROW (`creditCharged`), which is
 *     now the single record of the reservation — a process kill leaves it attributable, AND the
 *     retry READS it back so the org is not charged a second time for the same job (below);
 *   • `inferenceBilled` marks the moment a real (non-mock) report exists: a failure after that keeps
 *     the credit, because the inference genuinely ran and a refund would mint a free scan on retry.
 */
async function runRescoreJob(job: ScanJobRow, slug: string, ctx: OrgContext, summary: DrainSummary, opts: DrainOptions): Promise<void> {
  const repo = job.repoFullName;
  // An /api/org/import row carries the request's scan policy on its reason (scan-import-policy.ts):
  // the import enqueues its whole batch and this worker finishes whatever its 300s budget left queued.
  // Null for every other row, which keeps the default path below exactly as it was.
  const importPolicy = decodeImportReason(job.reason);
  // The ledger's actor names WHY the job exists; the policy flags are an implementation detail of it.
  const actorReason = importPolicy ? "import" : job.reason;
  if (importPolicy?.funnel) {
    // The public funnel is metered against a per-REQUEST allowance (the caller's IP / viewer). No
    // worker holds that request, so the job can be neither metered nor billed to credits here.
    summary.skipped += 1;
    await settleJob(job.id, { state: "skipped", error: "public-funnel import: the allowance is metered per request" });
    return;
  }
  // A push job (PUSH_JOB_REASON) is a rescan a webhook asked for, not a slot on the repo's schedule:
  // it never moves the cadence on any branch below, it backs off a recent failure, and it keeps the
  // push path's own metering and degrade guard. Every other reason runs exactly as before.
  const push = job.reason === PUSH_JOB_REASON;
  if (push) {
    // FAILURE BACKOFF, before any reserve. Reads the repo's last recorded attempt; a failed read is
    // reported and fails toward scanning, because the window bucket still caps the spend. A skip here
    // writes NO scan outcome: one would refresh lastScanAttemptAt and extend the backoff forever.
    const last = await getLastScanAttempt(slug, repo).catch(degradedRead("queue-worker last-attempt read (push backoff)", null));
    if (inFailureBackoff(last, opts.now?.())) {
      summary.skipped += 1;
      await settleJob(job.id, { state: "skipped", error: "failure backoff" });
      return;
    }
  }
  opts.onRepo?.({ repo, stage: "start" });

  // A broken installation only matters to a job that scans WITH it; a token-less or env-token import
  // never asked for one, and skipping it as `no_token` would strand a scan that could run.
  const usesInstall = !importPolicy || importPolicy.token === "install";
  if (usesInstall && (await ctx.brokenInstall(slug))) {
    summary.skippedNoToken += 1;
    if (job.repoId && !push) await advanceScheduleAfterFailure(job.repoId).catch(degradedRead("queue-worker schedule advance after failure", undefined));
    await recordScanOutcome(slug, repo, { ok: false, error: "installation token unavailable" }).catch(
      degradedRead("queue-worker scan-outcome write (no token)", undefined),
    );
    await settleJob(job.id, { state: "skipped", error: "installation token unavailable" });
    opts.onRepo?.({ repo, stage: "skipped", reason: "no_token" });
    return;
  }

  // A mock import is a free preview: no inference, so nothing to meter (the import route's own rule).
  // A push keeps the metering the push path always charged: isMeteredScan, which does NOT exempt a
  // BYOM org (this worker's own rule below does). Unifying the two is a pricing decision, not this one.
  const metered = push
    ? isMeteredScan(slug, false)
    : slug.toLowerCase() !== "public" && !importPolicy?.mock && !(await ctx.isByom(slug));
  // A REQUEUED row may already hold a credit. reapExpiredLeases returns a process-killed worker's job
  // to the queue by clearing state/claimedAt/claimedBy/leaseUntil — and deliberately NOT
  // `creditCharged`, because settleJob is the only path that clears it and it clears it only on a
  // refund. So `creditCharged: true` on a claimed row means exactly one thing: a credit was reserved
  // for this job and never given back. Reserving again would charge the org a second time for one
  // scan, and up to MAX_JOB_ATTEMPTS times for one repo — precisely in the scenario this queue was
  // built for (the 300s ceiling killing a worker mid-inference).
  //
  // NOT ATOMIC, and the residue is stated rather than hidden: a kill landing between
  // reserveScanCredit and markJobCredit still leaves the row saying `false`, so that attempt does
  // re-reserve. This narrows the window from the whole inference (seconds to minutes) to a single DB
  // write, which is as far as it goes without folding the reservation and the mark into one
  // transaction across two stores.
  const carriedCredit = metered && job.creditCharged;
  let charged = carriedCredit;
  if (metered && !carriedCredit) {
    // Ledger attribution: no human is in the loop when a job drains, so the honest actor is the queue
    // and the reason the job was enqueued for ("manual" from the dashboard, "cadence" from the cron,
    // "webhook:push" from a push) — the nearest true answer to "what spent this credit", and enough to tell
    // a scheduled rescan's spend apart from a user-triggered one on the same repo.
    const actor = `queue:${actorReason}`;
    const reservation = await reserveScanCredit(slug, repo, { actor });
    if (reservation.skip) {
      summary.skippedForCredits += 1;
      if (push) {
        // The push path's durable trace, kept: an owner has to see WHY a watched repo went stale, and
        // the fix (buy credits) is theirs. The copy is exempt from the failure backoff, so a top-up
        // scans on the next push. No cadence movement: a push skip is not the schedule's skip.
        await recordScanOutcome(slug, repo, { ok: false, error: CREDIT_SKIP_ERROR }).catch(
          degradedRead("queue-worker scan-outcome write (push credit skip)", undefined),
        );
      } else {
        // The repo waits its full cadence rather than re-qualifying every pass and jamming the queue.
        await settleCadence(job);
      }
      await settleJob(job.id, { state: "skipped", error: "insufficient credits" });
      opts.onRepo?.({ repo, stage: "skipped", reason: "insufficient_credits" });
      return;
    }
    charged = reservation.reserved;
    if (charged) await markJobCredit(job.id, true);
  }
  const refundCredit = async () => {
    // Same repo, same actor as the debit — a `refund` row that names what it reverses.
    await refundScanCredit(slug, charged, { actor: `queue:${actorReason}`, repoFullName: repo });
    return charged;
  };

  let inferenceBilled = false;
  try {
    const [owner = "", name = ""] = repo.split("/");
    const prev = await getScanReportByCommit(owner, name, { orgSlug: slug }).catch(degradedRead("queue-worker previous-report read", null));
    const report = await scanRepository(repo, {
      ...(await scanCredential(importPolicy, slug, ctx)),
      ...(importPolicy?.mock ? { mock: true } : {}),
      orgSlug: slug,
      onProgress: opts.onScanProgress ? (p) => opts.onScanProgress?.(repo, p) : undefined,
    });
    inferenceBilled = report.engine.provider !== "mock";
    // DEGRADE-TO-MOCK GUARD (push only). A push asks for a real grade; a provider outage still returns
    // a report stamped "mock", the deterministic FLOOR. Persisting it would make the floor the repo's
    // current reading and the next regression baseline, and the alert would blame the customer's repo
    // for our outage. So: no persist, no alert, refund, and a FAILED outcome so the backoff covers
    // the outage.
    if (push && !inferenceBilled) {
      const refunded = await refundCredit();
      await recordScanOutcome(slug, repo, { ok: false, error: PUSH_DEGRADED_ERROR }).catch(
        degradedRead("queue-worker scan-outcome write (push degraded)", undefined),
      );
      await settleJob(job.id, { state: "skipped", error: PUSH_DEGRADED_ERROR, creditRefunded: refunded });
      summary.skipped += 1;
      opts.onRepo?.({ repo, stage: "error", error: PUSH_DEGRADED_ERROR, charged: false });
      return;
    }
    const persisted = await persistScanReport(report, { orgSlug: slug });
    let refunded = false;
    if (shouldRefundScan(report, persisted)) refunded = await refundCredit();
    if (persisted && !persisted.deduped) {
      const orgId = (await getOrgId(slug).catch(degradedRead("queue-worker org lookup (regression alert)", null))) ?? undefined;
      await checkAndAlertRegression(prev, report, { orgId, orgSlug: slug });
    }
    if (!push) await settleCadence(job);
    await recordScanOutcome(slug, repo, { ok: true }).catch(degradedRead("queue-worker scan-outcome write (ok)", undefined));
    await settleJob(job.id, {
      state: "done",
      creditRefunded: refunded,
      result: { level: report.level.id, overall: report.overallScore, deduped: Boolean(persisted?.deduped) },
    });
    summary.done += 1;
    opts.onRepo?.({
      repo,
      stage: "done",
      level: report.level.id,
      overall: report.overallScore,
      posture: report.posture.id,
      adoption: report.adoptionScore,
      rigor: report.rigorScore,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "scan failed";
    const refunded = inferenceBilled ? false : await refundCredit();
    if (job.repoId && !push) await advanceScheduleAfterFailure(job.repoId).catch(degradedRead("queue-worker schedule advance after failure", undefined));
    await recordScanOutcome(slug, repo, { ok: false, error: msg }).catch(degradedRead("queue-worker scan-outcome write (failed)", undefined));
    await settleJob(job.id, { state: "failed", error: msg, creditRefunded: refunded });
    summary.failed += 1;
    const kept = inferenceBilled && charged ? " (credit kept, inference already ran)" : "";
    summary.errors.push(`${repo}: ${msg}${kept}`);
    opts.onRepo?.({ repo, stage: "error", error: msg, charged: inferenceBilled && charged });
  }
}
