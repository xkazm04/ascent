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
  getScanReportByCommit,
  isByomActive,
  persistScanReport,
  recordScanOutcome,
} from "@/lib/db";
import { claimJob, claimJobById, markJobCredit, reapExpiredLeases, settleJob, type ScanJobRow, type ScanLane } from "@/lib/db/scan-jobs";
import { getInstallationToken } from "@/lib/github/app";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { probeRepository } from "@/lib/scan-probe";
import { drainUntilDeadline } from "@/lib/pool";
import { getRepoSchedule } from "@/lib/db/org-watch";
import type { ScanProgress } from "@/lib/types";

export interface DrainOptions {
  concurrency: number;
  /** Wall-clock instant after which no NEW job is claimed (see `fleetDeadlineAt`). */
  deadlineAt: number;
  /** Diagnostics only — never an authorization input. */
  workerId?: string;
  /** Restrict the drain to these job ids (the interactive route's own run). Omitted = the whole lane. */
  jobIds?: string[];
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
    const id = await getInstallationIdForOwner(slug).catch(() => null);
    const tok = id ? await getInstallationToken(id).catch(() => undefined) : undefined;
    this.tokens.set(slug, tok);
    return tok;
  }

  /** True when this org HAS an installation but the token mint failed — a likely-revoked install, to
   *  be distinguished from a public org that legitimately scans tokenless. */
  async brokenInstall(slug: string): Promise<boolean> {
    const id = await getInstallationIdForOwner(slug).catch(() => null);
    if (!id) return false;
    return (await this.token(slug)) === undefined;
  }

  async isByom(slug: string): Promise<boolean> {
    const hit = this.byom.get(slug);
    if (hit !== undefined) return hit;
    const v = await isByomActive(slug).catch(() => false);
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
      const row = await getPrisma().organization.findUnique({ where: { id: orgId }, select: { slug: true } }).catch(() => null);
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
  await reapExpiredLeases().catch(() => 0);

  const ctx = new OrgContext();
  const pending = opts.jobIds ? [...opts.jobIds] : null;
  const supply = async (): Promise<ScanJobRow | null> => {
    if (pending) {
      for (;;) {
        const id = pending.shift();
        if (id === undefined) return null;
        const won = await claimJobById(id, workerId).catch(() => null);
        // A job another worker holds is not ours to run; move on rather than blocking this lane.
        if (won) return won;
        summary.skipped += 1;
        opts.onRepo?.({ repo: "", stage: "skipped", reason: "in_progress" });
      }
    }
    return claimJob(lane, workerId).catch(() => null);
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
  const schedule = await getRepoSchedule(job.repoId).catch(() => null);
  if (!schedule) return;
  await advanceToFullCadence(job.repoId, schedule).catch(() => {});
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

/**
 * The paid lane. Byte-for-byte the cron's money policy, moved not rewritten:
 *   • a broken installation token backs off 6h rather than skipping a whole cadence;
 *   • the credit is reserved BEFORE inference and recorded on the JOB ROW (`creditCharged`), which is
 *     now the single record of the reservation — a process kill leaves it attributable;
 *   • `inferenceBilled` marks the moment a real (non-mock) report exists: a failure after that keeps
 *     the credit, because the inference genuinely ran and a refund would mint a free scan on retry.
 */
async function runRescoreJob(job: ScanJobRow, slug: string, ctx: OrgContext, summary: DrainSummary, opts: DrainOptions): Promise<void> {
  const repo = job.repoFullName;
  opts.onRepo?.({ repo, stage: "start" });

  if (await ctx.brokenInstall(slug)) {
    summary.skippedNoToken += 1;
    if (job.repoId) await advanceScheduleAfterFailure(job.repoId).catch(() => {});
    await recordScanOutcome(slug, repo, { ok: false, error: "installation token unavailable" }).catch(() => {});
    await settleJob(job.id, { state: "skipped", error: "installation token unavailable" });
    opts.onRepo?.({ repo, stage: "skipped", reason: "no_token" });
    return;
  }

  const metered = slug.toLowerCase() !== "public" && !(await ctx.isByom(slug));
  let charged = false;
  if (metered) {
    const reservation = await reserveScanCredit(slug, repo);
    if (reservation.skip) {
      summary.skippedForCredits += 1;
      // The repo waits its full cadence rather than re-qualifying every pass and jamming the queue.
      await settleCadence(job);
      await settleJob(job.id, { state: "skipped", error: "insufficient credits" });
      opts.onRepo?.({ repo, stage: "skipped", reason: "insufficient_credits" });
      return;
    }
    charged = reservation.reserved;
    if (charged) await markJobCredit(job.id, true);
  }
  const refundCredit = async () => {
    await refundScanCredit(slug, charged);
    return charged;
  };

  let inferenceBilled = false;
  try {
    const token = await ctx.token(slug);
    const [owner = "", name = ""] = repo.split("/");
    const prev = await getScanReportByCommit(owner, name, { orgSlug: slug }).catch(() => null);
    const report = await scanRepository(repo, {
      token,
      orgSlug: slug,
      onProgress: opts.onScanProgress ? (p) => opts.onScanProgress?.(repo, p) : undefined,
    });
    inferenceBilled = report.engine.provider !== "mock";
    const persisted = await persistScanReport(report, { orgSlug: slug });
    let refunded = false;
    if (shouldRefundScan(report, persisted)) refunded = await refundCredit();
    if (persisted && !persisted.deduped) {
      const orgId = (await getOrgId(slug).catch(() => null)) ?? undefined;
      await checkAndAlertRegression(prev, report, { orgId, orgSlug: slug });
    }
    await settleCadence(job);
    await recordScanOutcome(slug, repo, { ok: true }).catch(() => {});
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
    if (job.repoId) await advanceScheduleAfterFailure(job.repoId).catch(() => {});
    await recordScanOutcome(slug, repo, { ok: false, error: msg }).catch(() => {});
    await settleJob(job.id, { state: "failed", error: msg, creditRefunded: refunded });
    summary.failed += 1;
    const kept = inferenceBilled && charged ? " (credit kept, inference already ran)" : "";
    summary.errors.push(`${repo}: ${msg}${kept}`);
    opts.onRepo?.({ repo, stage: "error", error: msg, charged: inferenceBilled && charged });
  }
}
