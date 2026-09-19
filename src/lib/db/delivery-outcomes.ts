// Delivery outcomes (W4): deployment frequency, change-failure rate, restore time — and the number
// this wave exists for, the AUTHORSHIP SPLIT.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE CLAIM, AND EXACTLY HOW FAR IT GOES.
//
// "AI-authored changes in your org fail at X% versus Y% for human-authored" is the most quotable
// sentence this product can produce. It is also the one a skeptical reader will attack first, so
// every part of it is built to survive that:
//
//   ATTRIBUTION IS AN EQUALITY, NOT A GUESS. A deployment names the sha it shipped; an AiChange row
//   carries its merge-commit sha. The link is `deployment.sha === aiChange.mergeCommitSha`. The
//   tempting alternative — "the PR that merged closest before this deploy" — is a time-window
//   heuristic, and under a headline claim like this one a wrong attribution is not a rounding error,
//   it is the whole claim.
//
//   COVERAGE IS PUBLISHED. Squash-merges, deploys of a merge train, tag-based deploys and repos
//   scanned before W4 all produce deployments no change matches. Those are counted as
//   `unattributed` and reported beside the split, because a rate computed over 12 of 51 deployments
//   means something very different from one computed over 49.
//
//   "FAILURE" MEANS THE DEPLOYMENT FAILED. Not "caused an incident" — that is unobservable from this
//   API, and conflating them would be the exact over-claim the product's discipline forbids.
//
//   HUMAN-AUTHORED IS A RESIDUAL, AND SAYS SO. A deployment attributed to a merged PR that carries
//   NO AiChange row is counted as human-authored. That is a lower bound on AI: unmarked AI
//   assistance is invisible to the detector, so the human bucket is contaminated in AI's favour —
//   which means a measured AI-fails-more result is conservative, and an AI-fails-less result should
//   be read with that in mind. Stated in the model and repeated in the UI.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { FAILED_STATES } from "@/lib/github/deployments";

/** The minimum deployments in a bucket before a rate is reported. Below it: null, not a wild number. */
export const MIN_DEPLOYMENTS = 5;

export interface DeploymentRow {
  repoFullName: string;
  environment: string;
  sha: string;
  state: string;
  createdAt: Date;
  statusAt: Date | null;
}

/** One authorship bucket's outcome numbers. */
export interface OutcomeBucket {
  deployments: number;
  failed: number;
  /** Share of deployments that failed, 0..100. Null under MIN_DEPLOYMENTS — never a 1-of-1 "100%". */
  failureRate: number | null;
}

export interface DeliveryOutcomes {
  /** Every deployment in the window, whatever its attribution. */
  total: number;
  failed: number;
  /** Fleet change-failure rate over ALL deployments. Null under the sample floor. */
  failureRate: number | null;
  /** Successful deployments per week, over the window's own span. Null when the span is unknown. */
  perWeek: number | null;
  /**
   * Median hours from a failed deployment to the next SUCCESSFUL one in the same repo+environment.
   * A proxy for restore time, labelled as one. Null when no failure was followed by a success.
   */
  medianRestoreHours: number | null;
  /** Deployments matched to a merged change by sha equality. */
  attributed: number;
  /** Deployments no change matched — squash merges, merge trains, tag deploys, pre-W4 scans. */
  unattributed: number;
  /** Attribution coverage, 0..100. The number that says how much the split below is worth. */
  coverage: number | null;
  ai: OutcomeBucket;
  human: OutcomeBucket;
  /** ai.failureRate − human.failureRate, in points. Null unless BOTH buckets cleared the floor. */
  failureRateGap: number | null;
  environments: string[];
  from: string | null;
  to: string | null;
}

const HOUR_MS = 3_600_000;

function rate(failed: number, total: number): number | null {
  if (total < MIN_DEPLOYMENTS) return null;
  return Math.round((failed / total) * 100);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

/**
 * Median time from a failed deployment to the next successful one in the SAME repo + environment.
 *
 * Deliberately not "time to restore service": nothing here observes service. It is the interval
 * between a failed deploy and the next good one, which is a proxy an engineer can sanity-check
 * against their own memory of the week. A failure never followed by a success contributes nothing —
 * an unresolved failure has no duration yet, and assuming "still broken as of now" would let one
 * abandoned environment dominate the median.
 */
export function restoreHours(rows: DeploymentRow[]): number | null {
  const byKey = new Map<string, DeploymentRow[]>();
  for (const r of rows) {
    const k = `${r.repoFullName}::${r.environment}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const gaps: number[] = [];
  for (const list of byKey.values()) {
    const ordered = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let failedAt: number | null = null;
    for (const d of ordered) {
      const at = (d.statusAt ?? d.createdAt).getTime();
      if (FAILED_STATES.has(d.state)) {
        // Keep the FIRST failure of a run: a burst of retries is one outage, not several.
        if (failedAt == null) failedAt = at;
      } else if (d.state === "success" && failedAt != null) {
        gaps.push(Math.max(0, (at - failedAt) / HOUR_MS));
        failedAt = null;
      }
    }
  }
  return median(gaps.map((g) => Math.round(g * 10) / 10));
}

export interface OutcomeInput {
  deployments: DeploymentRow[];
  /** Merge-commit SHAs (lower-cased) of AI-attributed merged changes in the window. */
  aiShas: Set<string>;
  /** Merge-commit SHAs of ALL merged PRs we know of — the attribution universe. */
  knownShas: Set<string>;
}

/** Fold deployments + the sha sets into the outcome model. Pure. */
export function buildDeliveryOutcomes(input: OutcomeInput): DeliveryOutcomes {
  const { deployments, aiShas, knownShas } = input;
  const failed = deployments.filter((d) => FAILED_STATES.has(d.state));

  // Attribution: a deployment is attributed when its sha matches a merged PR we recorded. Anything
  // else is unattributed and is EXCLUDED from the split rather than defaulted into a bucket.
  const attributedRows = deployments.filter((d) => knownShas.has(d.sha));
  const aiRows = attributedRows.filter((d) => aiShas.has(d.sha));
  const humanRows = attributedRows.filter((d) => !aiShas.has(d.sha));

  const bucket = (rows: DeploymentRow[]): OutcomeBucket => {
    const f = rows.filter((d) => FAILED_STATES.has(d.state)).length;
    return { deployments: rows.length, failed: f, failureRate: rate(f, rows.length) };
  };
  const ai = bucket(aiRows);
  const human = bucket(humanRows);

  const times = deployments.map((d) => d.createdAt.getTime());
  const from = times.length ? Math.min(...times) : null;
  const to = times.length ? Math.max(...times) : null;
  const spanWeeks = from != null && to != null ? Math.max(1, (to - from) / (7 * 24 * HOUR_MS)) : null;
  const successes = deployments.filter((d) => d.state === "success").length;

  return {
    total: deployments.length,
    failed: failed.length,
    failureRate: rate(failed.length, deployments.length),
    perWeek: spanWeeks != null ? Math.round((successes / spanWeeks) * 10) / 10 : null,
    medianRestoreHours: restoreHours(deployments),
    attributed: attributedRows.length,
    unattributed: deployments.length - attributedRows.length,
    coverage: deployments.length > 0 ? Math.round((attributedRows.length / deployments.length) * 100) : null,
    ai,
    human,
    // Only meaningful when BOTH sides cleared the sample floor. One side at null makes the
    // difference unknowable, not zero.
    failureRateGap: ai.failureRate != null && human.failureRate != null ? ai.failureRate - human.failureRate : null,
    environments: [...new Set(deployments.map((d) => d.environment))].sort(),
    from: from == null ? null : new Date(from).toISOString(),
    to: to == null ? null : new Date(to).toISOString(),
  };
}

/** Read + assemble for `orgSlug` over the window. Null when there is no DB / no org. */
export async function getDeliveryOutcomes(
  orgSlug: string,
  window: { start: Date | null; end: Date | null },
): Promise<DeliveryOutcomes | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (window.start) createdAt.gte = window.start;
  if (window.end) createdAt.lte = window.end;
  const scoped = createdAt.gte || createdAt.lte ? { createdAt } : {};

  const [deps, repos] = await Promise.all([
    prisma.deployment.findMany({
      where: { orgId: org.id, ...scoped },
      select: {
        environment: true,
        sha: true,
        state: true,
        createdAt: true,
        statusAt: true,
        repo: { select: { fullName: true } },
      },
    }),
    // THE ATTRIBUTION UNIVERSE comes from the merge-sha index in each repo's latest-scan `prStats`
    // blob — the same latest-scan-blobs pattern org-rework.ts uses.
    //
    // It cannot come from `AiChange`: that table stores ONLY AI-attributed PRs by construction (the
    // evidence pack depends on that), so a deployment failing to match an AI sha would be
    // indistinguishable between "a human wrote it" and "we could not attribute it" — which makes an
    // AI-vs-human comparison impossible to state honestly. The index carries every merged PR with
    // its AI flag, so both buckets are real and the residual is genuinely "unattributed".
    prisma.repository.findMany({
      where: { orgId: org.id },
      select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { prStats: true } } },
    }),
  ]);

  const aiShas = new Set<string>();
  const knownShas = new Set<string>();
  for (const r of repos) {
    const blob = r.scans[0]?.prStats;
    if (!blob) continue;
    try {
      const parsed = JSON.parse(blob) as { mergedShas?: { s?: string; a?: number }[] };
      for (const e of parsed.mergedShas ?? []) {
        const sha = typeof e?.s === "string" ? e.s.toLowerCase() : "";
        if (!sha) continue;
        knownShas.add(sha);
        if (e.a === 1) aiShas.add(sha);
      }
    } catch {
      // A malformed blob contributes no shas — its deployments read as unattributed, which is the
      // honest outcome and is already counted and disclosed.
    }
  }

  const rows: DeploymentRow[] = deps.map((d) => ({
    repoFullName: d.repo.fullName,
    environment: d.environment,
    sha: d.sha,
    state: d.state,
    createdAt: d.createdAt,
    statusAt: d.statusAt,
  }));

  return buildDeliveryOutcomes({ deployments: rows, aiShas, knownShas });
}
