// The ONE check-writing path for a PR maturity gate: score the PR head, diff it against the base,
// and post a GitHub Check Run (the merge status) + a sticky PR comment.
//
// Extracted verbatim from the App webhook route (src/app/api/app/webhook/route.ts) so a SECOND
// trigger — an org gate-policy change re-evaluating already-open PRs — can re-run the exact same
// gate instead of forking a parallel check writer that would inevitably drift. A Next.js route file
// may only export the HTTP-method / segment-config names, so the shared logic lives here rather
// than being exported from route.ts.
//
// The webhook's replay/dedup machinery (installationMatchesOwner, forgetDelivery) stays in the
// route and is injected through `PrGateHooks`, so this module carries no webhook-specific state and
// a non-webhook caller (the policy sweep) simply omits the hooks.

import { getInstallationToken } from "@/lib/github/app";
import { getOrgGatePolicy, reportPermalink } from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { publicBaseUrl } from "@/lib/site";
import { evaluateGate } from "@/lib/scoring/gate";
import { buildGateComment, GATE_COMMENT_MARKER } from "@/lib/scoring/gate-comment";
import { createCheckRun, upsertStickyComment } from "@/lib/github/checks";
import { diffReports } from "@/lib/scoring/engine";

/** The "Re-run" button surfaced on the gate Check Run — clicking it re-delivers a check_run webhook. */
export const RERUN_ACTION = [{ label: "Re-run", description: "Re-evaluate this PR's maturity", identifier: "rescan" }];

export interface PrGateRef {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  /** PR head commit SHA — what the check is attached to AND the ref we score. */
  headSha: string;
  /** PR base branch (e.g. "main") — the ref we diff against to show the PR's impact. */
  baseRef: string;
}

export interface PrGateHooks {
  /**
   * Confirm the (installationId, owner) pair before a token is minted. The webhook supplies its
   * payload-binding check here; a caller that already resolved the installation FROM the org (the
   * gate-policy sweep) has nothing to confirm and omits it. Returning false aborts the gate and
   * fires `onRetryable`.
   */
  confirmOwner?: (installationId: number, owner: string) => Promise<boolean>;
  /**
   * Called on every abort/failure exit so a caller holding a dedup claim can release it and let a
   * retry through (the webhook's forgetDelivery). Best-effort; never throws out of the gate.
   */
  onRetryable?: () => Promise<void> | void;
}

/**
 * Run the maturity gate for a PR. Scores the PR's **head** (so adding tests / a CLAUDE.md / CI in
 * the PR actually moves the gate), diffs it against the **base** branch to show what the PR
 * changes, and posts a Check Run (the merge status) + a sticky comment. Deterministic (mock) so
 * it's fast and free of LLM spend; both scans use the same engine + token, so the diff is clean.
 *
 * Never throws: every failure path posts a neutral "could not run" check (once a token exists) and
 * fires `onRetryable`.
 */
export async function runPrGate(ref: PrGateRef, hooks: PrGateHooks = {}): Promise<void> {
  const { installationId, owner, repo, prNumber, headSha, baseRef } = ref;
  const retryable = async () => {
    try {
      await hooks.onRetryable?.();
    } catch (err) {
      console.warn("[pr-gate] onRetryable hook failed", err instanceof Error ? err.message : err);
    }
  };
  // Hoisted so the catch can post a neutral check on the SAME token when a failure happens after mint.
  let token: string | undefined;
  try {
    if (hooks.confirmOwner && !(await hooks.confirmOwner(installationId, owner))) {
      // github-app-installation-webhooks #2: the owner check collapses "forged/misrouted mismatch"
      // (want: drop) and "transient DB/GitHub blip" (want: retry) into one `false`. A bare `return`
      // here is INSIDE the try, so the catch's release never runs and the delivery stays claimed in
      // BOTH the in-memory Map and the DB claim — a momentary blip then permanently loses this PR
      // gate (GitHub only redelivers on a non-2xx, and we already 2xx'd). Release on EVERY exit path
      // so a redelivery retries; a genuine forgery simply re-fails the owner check again, harmlessly.
      await retryable();
      return;
    }
    token = await getInstallationToken(installationId);
    const fullName = `${owner}/${repo}`;

    // Score the PR head. A fork PR's head commit can be unreachable via the base repo's tree API —
    // fall back to the default branch so the check still posts (availability trade-off). INTEGRITY
    // trade-off (github-app-installation-webhooks 2026-07-16 #3): a default-branch verdict structurally
    // cannot fail on anything the PR itself changes (a fork PR deleting the test suite would sail
    // through, and a red default branch would block an innocent fork PR). scoredHead therefore threads
    // into buildGateComment below, which posts the fallback as a NEUTRAL check that says plainly it
    // scored the default branch — a required-status consumer must treat fallback verdicts as
    // non-authoritative, never as a pass/fail on the PR's own tree.
    let headReport;
    let scoredHead = true;
    try {
      headReport = await scanRepository(fullName, { mock: true, token, ref: headSha });
    } catch (err) {
      console.warn("[pr-gate] head-ref scan failed, falling back to default branch", err instanceof Error ? err.message : err);
      headReport = await scanRepository(fullName, { mock: true, token });
      scoredHead = false;
    }
    // Honor the org's persisted gate policy (GATE-1) — the App check previously ignored any configured
    // bar and always used archetype defaults. Falls back to the default when unset/DB-less.
    //
    // NOT `.catch(() => null)`: getOrgGatePolicy returns null without throwing for every LEGITIMATE
    // "no bar configured" case (no DB, unknown org, unset column, unparseable value), so a throw means
    // only that we could not READ the bar. Swallowing it published a green Check Run scored against the
    // archetype default — silently relaxing the merge gate for the duration of a DB blip, on the one
    // status that actually blocks merges. Letting it propagate reaches the outer catch, which posts the
    // neutral "could not run" check and releases the delivery so GitHub's redelivery retries.
    const policy = (await getOrgGatePolicy(owner)) ?? undefined;
    const gate = evaluateGate(headReport, policy);

    // Diff base → head to show the PR's impact. Only meaningful when we actually scored the head
    // ref; both scans are mock at two refs, so the delta reflects the PR's tree changes alone.
    let baseline = null;
    if (scoredHead) {
      const baseReport = await scanRepository(fullName, { mock: true, token, ref: baseRef }).catch(() => null);
      if (baseReport) baseline = diffReports(baseReport, headReport);
    }

    const comment = buildGateComment(headReport, gate, baseline, { baselineSuffix: "in this PR", scoredHead });
    const detailsUrl = publicBaseUrl() + reportPermalink(fullName, headReport.repo.headSha);

    // GATE-3 / ci-gate-status-checks #3: the Check Run IS the required merge status — a swallowed failure
    // here leaves it permanently pending. createCheckRun now retries transient GitHub errors internally;
    // if it STILL rejects, let it THROW (no inline .catch) so the outer catch posts the neutral "could not
    // run" check AND releases the delivery for a redelivery retry. Silently logging it (the old behavior)
    // returned normally, skipping both the neutral fallback and the release — the exact silent hole.
    await createCheckRun({
      token,
      owner,
      repo,
      headSha,
      conclusion: comment.conclusion,
      title: comment.title,
      summary: comment.summary,
      detailsUrl: detailsUrl.startsWith("http") ? detailsUrl : undefined,
      actions: RERUN_ACTION, // GATE-2: a "Re-run" button so a verdict can be refreshed without a new push
    });

    // The sticky comment is best-effort narrative (not the merge gate) — a failure here is logged and
    // swallowed so it doesn't spuriously trip the neutral-check fallback; the redelivery retry reposts it.
    await upsertStickyComment({ token, owner, repo, prNumber, marker: GATE_COMMENT_MARKER, body: comment.commentBody }).catch(
      (err) => console.error("[pr-gate] sticky comment failed", err instanceof Error ? err.message : err),
    );
  } catch (err) {
    console.error("[pr-gate] PR gate failed", err instanceof Error ? err.message : err);
    // GATE-3: a hard failure must NOT leave a *required* check silently absent (it would block merge
    // forever with no explanation). Post a neutral "couldn't evaluate" check (with a Re-run button) so
    // the author sees a reason and has recourse. Best-effort — only possible once a token was minted.
    if (token) {
      await createCheckRun({
        token,
        owner,
        repo,
        headSha,
        conclusion: "neutral",
        title: "Maturity gate could not run",
        summary: "Ascent couldn't evaluate this PR's maturity (a transient error). Re-run the check, or push a new commit.",
        actions: RERUN_ACTION,
      }).catch((e) => console.error("[pr-gate] neutral check failed", e instanceof Error ? e.message : e));
    }
    // The deferred gate failed after we already 2xx'd — release the delivery so a redelivery retries.
    await retryable();
  }
}
