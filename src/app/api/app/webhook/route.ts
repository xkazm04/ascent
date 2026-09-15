// POST /api/app/webhook — GitHub App events. Verifies the HMAC signature, then:
//   • installation events                      → keep stored installations in sync.
//   • pull_request (opened/synced/reopened)    → run the maturity gate on the repo and post a
//                                                Check Run + sticky PR comment (Feature 2).
//   • push (to the default branch, head moved) → re-scan a watched repo and alert on a
//                                                regression vs the prior scan (Feature 4), throttled to
//                                                one paid scan per repo per PUSH_RESCAN_MIN_INTERVAL_MINUTES
//                                                and PAID FOR: the rescan reserves a prepaid credit
//                                                before inference exactly like the queue worker, and
//                                                is skipped (never served free) when the org is out.
//   • branch_protection_rule / repository_ruleset / repository / member / team
//                                             → enqueue a FREE control probe (moonshot #10). These
//                                                events move a repo's governance posture without
//                                                touching its code, cost no credit, and are never
//                                                trusted for the control STATE — only for what to
//                                                re-read.
//
// GitHub expects a fast 2xx, so the scan work runs in `after()` — scheduled to execute AFTER the
// response is sent, within the route's maxDuration. We always 200 (even on handler errors) so
// GitHub doesn't retry on our transient issues.

import { NextResponse, after } from "next/server";
import {
  AppApiError,
  getInstallation,
  getInstallationToken,
  isAppConfigured,
  listInstallationReposResult,
  verifyWebhook,
} from "@/lib/github/app";
import {
  claimWebhookDelivery,
  getInstallationIdForOwner,
  getOrgId,
  getScanReportByCommit,
  isDbConfigured,
  isRepoWatched,
  listWatchedRepos,
  persistScanReport,
  recordScanOutcome,
  reconcileWatchedRepos,
  removeInstallation,
  resumeInstallation,
  suspendInstallation,
  upsertInstallation,
} from "@/lib/db";
import { scanRepository } from "@/lib/scan";
// Deep path, not the "@/lib/db" barrel: db/index.ts is Director-owned and its queue re-export lands
// at merge (see the handoff). The webhook's half of moonshot #10 is enqueue-ONLY — no observation is
// written here, because a signed payload is not evidence of a control's state.
import { enqueueProbeJob } from "@/lib/db/scan-jobs";
// MOONSHOT #1 (W3-M) — the two things a delivery carries that a later probe can NEVER recover: the
// actor, and the moment. `normalizeGovernanceEvent` extracts only those; it never produces a control
// state (see that module's header for why payload-sourced state would swallow its own alert).
// `readReviewApproval` is the AI-change reducer's half of the same fan-in.
import { GOVERNANCE_EVENTS, normalizeGovernanceEvent, readReviewApproval } from "@/lib/github/governance-events";
import { latestObservations, recordObservations, type ControlSample } from "@/lib/db/control-observations";
import { resolveRepoJobRef } from "@/lib/db/scan-jobs";
import { upsertLiveAiChange } from "@/lib/db/ai-changes";
import { readAiInvolvement } from "@/lib/analyze/pulls";
import type { PrNode } from "@/lib/github/graphql";
import { AI_TOOLS } from "@/lib/analyze/ai-tools";
import { abandonDelivery, deliveryAlreadySeen, forgetLocalDelivery } from "@/lib/github/webhook-delivery";
// The PR gate itself now lives in @/lib/github/pr-gate so the org gate-policy sweep can re-run the
// SAME check-writing path (a route file may only export the HTTP-method / segment-config names, so
// it could not be shared from here). This route still owns the replay/dedup machinery and injects
// it as hooks — behavior is unchanged.
import { runPrGate, type PrGateHooks } from "@/lib/github/pr-gate";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
// The push rescan is a REAL, LLM-billed scan and must pay for itself. Same pair the queue worker and
// the import funnel use (src/lib/scan-queue-worker.ts, src/app/api/org/import/route.ts) — deliberately
// NOT a second reserve mechanism, and NOT `scanCreditGate` (that shape exists to 402 an interactive
// caller; a webhook has nobody to 402, so it mirrors the worker's reserve/skip/refund instead).
// `reserveScanCredit` also fires `maybeAlertLowCredits` on a debit that crossed the low-water mark, so
// a push-funded depletion pushes the same lifecycle alert /api/scan does.
import { refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { isMeteredScan } from "@/lib/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface WebhookPayload {
  action?: string;
  installation?: { id: number; account?: { login?: string } };
  repository?: { full_name?: string; name?: string; default_branch?: string; owner?: { login?: string } };
  pull_request?: {
    number?: number;
    head?: { sha?: string; ref?: string };
    base?: { ref?: string };
    // MOONSHOT #1 — the fields the live AI-change reducer reads. All optional: the PR-gate arm above
    // has always used only `number`/`head`/`base`, and a delivery that omits these simply yields no
    // AI-change row rather than a partial one.
    title?: string;
    body?: string;
    draft?: boolean;
    created_at?: string;
    merged?: boolean;
    merged_at?: string | null;
    merge_commit_sha?: string | null;
    user?: { login?: string; type?: string };
    labels?: { name?: string }[];
  };
  ref?: string;
  after?: string;
  deleted?: boolean;
  // check_run event: a "Re-run" button click (requested_action) or GitHub's rerequested.
  check_run?: { head_sha?: string; pull_requests?: { number?: number; base?: { ref?: string } }[] };
  requested_action?: { identifier?: string };
  // Control-probe events (moonshot #10). Only the ORGANIZATION/owner is read off these — the payload
  // names WHAT to re-read, never the control state itself (see enqueueControlProbe).
  organization?: { login?: string };
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

/** Repo-scoped events that move a CONTROL rather than the code (moonshot #10). Each enqueues a free
 *  probe of that one repo. */
const REPO_CONTROL_EVENTS = new Set(["branch_protection_rule", "repository_ruleset", "repository"]);
/** Owner-scoped control events — the access shape moved, so the org's watched repos are re-observed. */
const ORG_CONTROL_EVENTS = new Set(["member", "team"]);

// Replay defense (in-memory fast path + the shared "abort, but release the delivery" helper) lives in
// @/lib/github/webhook-delivery: deliveryAlreadySeen, forgetLocalDelivery, forgetDelivery, abandonDelivery.
// See that module's doc comment for the process-local-vs-cross-instance tradeoff.

// github-app-installation-webhooks #5: a GitHub HMAC never expires, so a captured, still-validly-signed
// delivery can be REPLAYED anytime within GitHub's redelivery horizon (hours/days). The in-memory cache above
// is only a 10-min, process-local FAST PATH; the AUTHORITATIVE cross-instance replay defense is the DB claim
// (claimWebhookDelivery), whose default TTL also matched 10 min — far shorter than the window it defends, so
// a replay 10 min later re-claimed and fully reprocessed (double scan/alert/re-posted checks). Persist the
// claim for a full day so a replay across the redelivery horizon is rejected. A LEGITIMATE redelivery after a
// failure still retries: forgetDelivery() DELETES the claim on a deferred-work failure, so only
// SUCCESSFULLY-processed ids stay claimed — exactly the replay we want to keep rejecting.
const REPLAY_HORIZON_MS = 24 * 60 * 60_000;

/** Bind a webhook's claimed installation to its owner before we mint a token / scan. For a KNOWN
 *  owner, the stored mapping must agree. For an UNKNOWN owner (no mapping yet), the HMAC proves the
 *  delivery is authentic but NOT that a forged/replayed payload's (installationId, owner) pair is
 *  real — so confirm with GitHub (App-JWT authoritative) that the installation actually belongs to
 *  the claimed owner, and fail closed if we can't. (Previously unknown owners were allowed through,
 *  i.e. fail-open.) */
async function installationMatchesOwner(installationId: number, owner: string): Promise<boolean> {
  let known: string | null;
  try {
    known = await getInstallationIdForOwner(owner);
  } catch (err) {
    // A DB error must NOT collapse "no mapping exists" and "couldn't determine if a mapping exists"
    // into the same value — the old `.catch(() => null)` silently downgraded the strict stored-id
    // match to the looser GitHub-confirmation path whenever the lookup hiccupped. Fail closed.
    console.warn(
      `[webhook] owner-mapping lookup failed for ${owner}; failing closed`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
  if (known) {
    if (known !== String(installationId)) {
      console.warn(
        `[webhook] installation mismatch for ${owner}: payload=${installationId} stored=${known}; skipping`,
      );
      return false;
    }
    return true;
  }
  try {
    const info = await getInstallation(installationId);
    const matches = info.account.toLowerCase() === owner.toLowerCase();
    if (!matches) {
      console.warn(
        `[webhook] installation ${installationId} account ${info.account} != payload owner ${owner}; skipping`,
      );
      return false;
    }
    // Persist the GitHub-confirmed (owner → installation) pairing so subsequent events for this owner
    // take the stronger stored-mapping path (the cheap, authoritative `known === installationId` check)
    // instead of re-confirming live with GitHub every time. Best-effort: a write failure must not block
    // this rescan, which already confirmed the match.
    try {
      await upsertInstallation({ login: info.account, installationId });
    } catch (persistErr) {
      console.warn(
        `[webhook] could not persist confirmed mapping ${owner} -> ${installationId}`,
        persistErr instanceof Error ? persistErr.message : persistErr,
      );
    }
    return true;
  } catch (err) {
    console.warn(
      `[webhook] could not confirm installation ${installationId} for ${owner}; skipping`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Confirm a DESTRUCTIVE installation event against GitHub (App-JWT authoritative) before acting on it.
 * A validly-signed but forged/misrouted `installation.deleted`/`suspend` naming a VICTIM's still-active
 * installation id would otherwise wipe their watch/schedule, null their install id, and revoke their
 * live sessions — a single-delivery DoS. We only tear down when GitHub itself confirms the revocation:
 *  - `deleted`  → `getInstallation` 404s (the installation is genuinely gone).
 *  - `suspend`  → `getInstallation` returns it with `suspendedAt` set.
 * Any other outcome (still active, or a transient error we can't interpret) fails CLOSED: we do not
 * remove. A genuinely-revoked installation self-heals anyway — token mints 401 and invalidate.
 */
async function confirmRevocationWithGitHub(installationId: number, action: "deleted" | "suspend"): Promise<boolean> {
  try {
    const info = await getInstallation(installationId);
    // GitHub still has the installation. Only a confirmed suspension is a real revocation here; a
    // "deleted" event for a still-present installation is forged/misrouted.
    if (action === "suspend") return info.suspendedAt != null;
    console.warn(`[webhook] installation ${installationId} still active on GitHub; ignoring forged "deleted"`);
    return false;
  } catch (err) {
    // A 404 is GitHub confirming the installation is gone — the legitimate "deleted" case.
    if (err instanceof AppApiError && err.status === 404) return action === "deleted";
    console.warn(
      `[webhook] could not confirm ${action} of installation ${installationId}; failing closed`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * The webhook's half of the shared PR gate (@/lib/github/pr-gate): bind the claimed installation to
 * its owner before a token is minted, and release the delivery's dedup claim on any abort/failure so
 * a GitHub redelivery can retry. runPrGate itself carries no webhook state.
 */
function webhookGateHooks(deliveryId?: string): PrGateHooks {
  return {
    confirmOwner: installationMatchesOwner,
    onRetryable: () => abandonDelivery(deliveryId),
  };
}


/**
 * Reconcile the DB watch state against an installation's CURRENT accessible repos. Re-lists the live
 * set from GitHub and drops watch for any watched repo no longer in it — catching access changes the
 * webhook payload doesn't itemize as explicit "removed" rows (a "selected → all" flip, a paginated
 * "all → selected" narrowing). Best-effort + deferred: a listing failure SKIPS (so a transient GitHub
 * error can't be misread as "zero repos" and wipe the whole watch set); a later event re-reconciles.
 */
async function reconcileInstallationRepos(installationId: number, deliveryId?: string) {
  try {
    const { repos: live, truncated } = await listInstallationReposResult(installationId);
    // BUG (github-app-installation-webhooks #1): reconcileWatchedRepos' contract is "only pass a
    // COMPLETE live set" — it unwatches anything NOT in the set. A page-capped (truncated) listing is
    // a silently-incomplete success, so passing it would unwatch every watched repo beyond page 50 on
    // a large installation. Apply the same "fail-safe, don't wipe" discipline as the throwing path:
    // SKIP the destructive reconcile when the listing was incomplete; a later event re-reconciles.
    if (truncated) {
      console.warn(
        `[webhook] installation ${installationId}: repo listing truncated (incomplete); skipping watch reconcile to avoid unwatching repos past the page cap`,
      );
      return;
    }
    const dropped = await reconcileWatchedRepos(
      installationId,
      live.map((r) => r.fullName),
    );
    if (dropped > 0) {
      console.warn(`[webhook] installation ${installationId}: unwatched ${dropped} repo(s) no longer accessible`);
    }
  } catch (err) {
    // The deferred reconcile failed after we already 2xx'd — release the delivery so a redelivery
    // retries (same net as runPrGate/runPushRescan); otherwise a transient listing failure dedupes
    // the redelivery and the access change is lost until some later event happens to re-reconcile.
    await abandonDelivery(deliveryId, () =>
      console.warn(
        `[webhook] installation_repositories reconcile failed for ${installationId}`,
        err instanceof Error ? err.message : err,
      ),
    );
  }
}

// github-app-installation-webhooks #6: two default-branch pushes (C1 then C2) landing within seconds spawn
// two deferred runPushRescan runs that BOTH read `prev` (the regression baseline) BEFORE either persists —
// so both diff against the same stale baseline R0 (a C1 regression reverted by C2 is missed, or a two-step
// regression is mis-attributed). Serialize the read→scan→persist→diff sequence PER REPO so the next run's
// baseline read sees the immediately-prior persisted scan. This is a PROCESS-LOCAL lock (a push burst is
// typically routed to one warm instance); a cross-instance race is rarer and bounded, and the authoritative
// per-commit dedup (@@unique[repoId, headSha]) still prevents a double metered scan regardless.
const rescanChains = new Map<string, Promise<unknown>>();
function serializePerRepo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const tail = rescanChains.get(key) ?? Promise.resolve();
  const next = tail.then(fn, fn); // run fn after the prior rescan settles, success OR failure
  rescanChains.set(key, next);
  // Drop the map entry once this run is the tail so the map can't grow unbounded across many repos.
  void next.catch(() => {}).finally(() => {
    if (rescanChains.get(key) === next) rescanChains.delete(key);
  });
  return next;
}

/**
 * G1-05: a push-triggered rescan is a REAL, LLM-billed scan, and `onDefault && headMoved` used to fire
 * one per push with nothing throttling it — a busy monorepo or a CI force-push storm bought one full
 * paid scan per commit. This is the per-repo MINIMUM INTERVAL between push-triggered scans.
 *
 * State lives in the DB, not in memory: the debounce compares against the PRIOR PERSISTED SCAN's
 * `scannedAt` (the report `runPushRescan` already reads as its regression baseline, so the check costs
 * zero extra queries and zero new infrastructure). That makes the window CROSS-INSTANCE by construction —
 * unlike a process-local Map, a webhook fleet behind a load balancer shares one window per repo.
 *
 * Default 15 minutes: comfortably longer than a median scan (~6 min), so a burst can never queue scans
 * back-to-back, and it caps push-driven spend at ≤4 scans/hour/repo while keeping a watched repo's report
 * fresh within a quarter hour. Override with `PUSH_RESCAN_MIN_INTERVAL_MINUTES`; 0 disables the throttle
 * (every default-branch push scans, the old behavior).
 */
const DEFAULT_PUSH_RESCAN_MIN_INTERVAL_MINUTES = 15;
function pushRescanMinIntervalMs(): number {
  const minutes = Number(process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES);
  const m = Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_PUSH_RESCAN_MIN_INTERVAL_MINUTES;
  return m * 60_000;
}

/**
 * Should this push COALESCE into the repo's most recent scan instead of buying its own?
 * Pure, given the baseline report's `scannedAt`. An absent/garbled timestamp means we can't prove the
 * repo was scanned recently, so we scan (fail toward freshness — the same discipline as
 * `isPersistedScanFresh`); the per-commit `@@unique[repoId, headSha]` dedup still blocks a double charge
 * for an identical head.
 */
function withinPushRescanWindow(prevScannedAt: string | undefined, now: number = Date.now()): boolean {
  const window = pushRescanMinIntervalMs();
  if (window <= 0) return false; // throttle disabled
  const t = prevScannedAt ? new Date(prevScannedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return false;
  return now - t < window;
}

// ── Control-probe fan-in (moonshot #10) ──────────────────────────────────────────────────────────
// Five events change a repo's CONTROL posture without changing a line of code, so none of them used
// to reach us at all: branch_protection_rule, repository_ruleset, repository, member, team.
//
// THE PAYLOAD IS NEVER TRUSTED FOR CONTROL STATE. A `branch_protection_rule.deleted` delivery is
// treated as "re-read this repo", not as "protection is off" — a validly-signed but replayed or
// misrouted delivery would otherwise write a false governance record that outlives it. Only the
// probe's own re-read from GitHub produces an observation. That is the same discipline
// `installation_repositories` already follows for the destructive unwatch path.
//
// The work is a QUEUED JOB, not an inline read: GitHub wants a fast 2xx, a burst of rule edits would
// otherwise fan out to a burst of API calls, and the delivery id as the idempotency bucket makes a
// redelivery enqueue nothing new.

/** Cap on the org-wide fan-out of an owner-level event. A `member`/`team` change is org-scoped, but
 *  enqueuing one job per repo for a 900-repo fleet on every membership edit is a burst nobody asked
 *  for; the hourly cadence catches the tail either way. */
const ORG_EVENT_PROBE_CAP = 200;

async function enqueueControlProbe(
  installationId: number,
  owner: string,
  fullName: string,
  event: string,
  deliveryId?: string,
): Promise<void> {
  const orgSlug = owner.toLowerCase();
  if (!(await installationMatchesOwner(installationId, orgSlug))) {
    await abandonDelivery(deliveryId);
    return;
  }
  await enqueueProbeJob(orgSlug, fullName, `webhook:${event}`, deliveryId).catch((err) => {
    console.warn(`[webhook] could not enqueue a control probe for ${fullName}`, err instanceof Error ? err.message : err);
    return null;
  });
}

/**
 * MOONSHOT #1 — record WHO touched a control area and WHEN, without asserting what it became.
 *
 * The attribution row copies the control's CURRENT state and value unchanged from the newest
 * observation, so the (state, value) pair does not move and the ledger's transition flag stays false.
 * Three consequences, all deliberate:
 *   • it asserts nothing about the control — a forged or replayed delivery cannot write a false
 *     governance record, which is W3-L's frozen contract and the reason this is not a state write;
 *   • it cannot mask the probe's transition, because the probe still diffs against an unchanged pair;
 *   • it cannot alert, so a burst of rule edits pages nobody.
 *
 * A control with NO prior observation gets no attribution row: there is nothing to attribute against,
 * and inventing a baseline from a payload is the exact thing this design refuses.
 */
async function recordControlAttribution(
  orgSlug: string,
  fullName: string,
  event: string,
  payload: WebhookPayload,
  deliveryId?: string,
): Promise<void> {
  const attribution = normalizeGovernanceEvent(event, payload);
  // No actor means the delivery adds nothing a probe will not recover on its own — skip the write
  // rather than storing a row whose only content is "something happened, somewhere, to someone".
  if (!attribution || !attribution.actorLogin) return;

  const ref = await resolveRepoJobRef(orgSlug, fullName).catch(() => null);
  const repoId = ref?.repoId ?? null;
  if (!repoId) return;
  const current = await latestObservations(repoId).catch(() => []);
  const byId = new Map(current.map((o) => [o.controlId, o]));

  const samples: ControlSample[] = [];
  for (const controlId of attribution.controlIds) {
    const seen = byId.get(controlId);
    if (!seen) continue;
    samples.push({
      controlId,
      state: seen.state,
      value: seen.value,
      evidence: { ...attribution.evidence, actor: attribution.actorLogin, attribution: true },
      occurredAt: attribution.occurredAt ?? undefined,
    });
  }
  if (samples.length === 0) return;
  await recordObservations(orgSlug, repoId, samples, {
    repoFullName: fullName,
    source: "webhook",
    actorLogin: attribution.actorLogin,
    deliveryId: deliveryId ?? null,
  }).catch(() => null);
}

/**
 * MOONSHOT #1 — the live AI-change reducer for `pull_request_review` (approved) and
 * `pull_request.closed` (merged).
 *
 * AI involvement is decided by `readAiInvolvement`, IMPORTED from analyze/pulls.ts rather than
 * re-implemented: the webhook-sourced rows and the scan-sourced rows have to be one population, or
 * the conformance pack's count and its own percentage would disagree about who is in it.
 *
 * The predicate is fed a PrNode assembled from the delivery. Two channels work on webhook data
 * (`authored` — an AI agent opened it; `marked` — AI fingerprints in title/body/labels) and one does
 * NOT: `trailer` needs commit messages the payload does not carry. A trailer-only PR is therefore
 * invisible to this path and is picked up at the next scan — a known, bounded under-count in the
 * direction the pack already discloses (the population is a LOWER BOUND), never an over-count.
 */
async function reduceAiChangeEvent(orgSlug: string, event: string, payload: WebhookPayload): Promise<void> {
  const fullName = payload.repository?.full_name;
  const pr = payload.pull_request;
  if (!fullName || !pr?.number || !pr.created_at) return;

  const approval = event === "pull_request_review" ? readReviewApproval(payload) : null;
  const merged = event === "pull_request" && payload.action === "closed" && pr.merged === true;
  // Nothing to record: a review that was not an approval, or a PR that closed without merging. A
  // closed-unmerged PR is genuinely not evidence — the pre-merge control was never due to operate.
  if (!approval && !merged) return;

  const node = {
    number: pr.number,
    title: pr.title ?? "",
    bodyText: pr.body ?? "",
    isDraft: pr.draft ?? false,
    state: merged ? "MERGED" : "OPEN",
    createdAt: pr.created_at,
    mergedAt: pr.merged_at ?? null,
    closedAt: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    author: pr.user?.login ? { login: pr.user.login, __typename: pr.user.type === "Bot" ? "Bot" : "User" } : null,
    labels: { nodes: (pr.labels ?? []).map((l) => ({ name: l.name ?? "" })) },
    reviews: { totalCount: 0, nodes: [] },
    comments: { totalCount: 0 },
  } as PrNode;

  const ai = readAiInvolvement(node);
  // NOT AI-involved by the shared predicate ⇒ no row. The population is AI-attributed changes; a
  // human PR entering it would inflate the denominator every published rate is computed over.
  if (!ai.signal) return;

  const tools = AI_TOOLS.filter((t) => new RegExp(t.token, "i").test(ai.toolText)).map((t) => t.name);
  await upsertLiveAiChange(orgSlug, {
    repoFullName: fullName,
    prNumber: pr.number,
    title: pr.title ?? "",
    authorLogin: pr.user?.login ?? null,
    authorIsBot: pr.user?.type === "Bot",
    aiSignal: ai.signal,
    aiTools: tools.join(", "),
    state: merged ? "MERGED" : "OPEN",
    createdAt: pr.created_at,
    mergedAt: pr.merged_at ?? null,
    mergeCommitSha: pr.merge_commit_sha ? pr.merge_commit_sha.toLowerCase() : null,
    approved: approval !== null,
    approverLogin: approval?.approverLogin ?? null,
    approvedAt: approval?.approvedAt ?? null,
    // The DELIVERY's arrival, not the review's submission time — this column exists precisely to
    // keep those two apart (see AiChange.approvalObservedAt).
    approvalObservedAt: approval ? new Date().toISOString() : null,
  }).catch(() => false);
}

/** An owner-level control change (`member`, `team`): re-observe the org's WATCHED repos. */
async function enqueueOrgControlProbes(installationId: number, owner: string, event: string, deliveryId?: string): Promise<void> {
  const orgSlug = owner.toLowerCase();
  if (!(await installationMatchesOwner(installationId, orgSlug))) {
    await abandonDelivery(deliveryId);
    return;
  }
  const repos = await listWatchedRepos(orgSlug).catch(() => []);
  for (const r of repos.slice(0, ORG_EVENT_PROBE_CAP)) {
    await enqueueProbeJob(orgSlug, r.fullName, `webhook:${event}`, deliveryId).catch(() => null);
  }
}

/** Re-scan a watched repo on push, persist, and alert on a regression vs the prior scan. */
async function runPushRescan(installationId: number, owner: string, repo: string, deliveryId?: string) {
  try {
    const fullName = `${owner}/${repo}`;
    const orgSlug = owner.toLowerCase();
    // Cheap local short-circuit FIRST: only watched repos auto-rescan, so bail on the DB check before
    // the (potentially GitHub-round-tripping) owner confirm. For a push from an unrecorded org the
    // owner-confirm always dead-ended here anyway, burning a GitHub API call per push (rate-limit burn).
    if (!(await isRepoWatched(orgSlug, fullName))) return; // deterministic "not watched" — nothing to retry
    if (!(await installationMatchesOwner(installationId, owner))) {
      // github-app-installation-webhooks #2 (push path): same as runPrGate — a `false` here can be a
      // transient DB/GitHub blip, and this bare return is inside the try, so release the delivery so a
      // redelivery retries the rescan rather than being silently deduped and the push scan lost forever.
      await abandonDelivery(deliveryId);
      return;
    }
    // #6: read the baseline, scan, persist and diff as ONE per-repo critical section, so a concurrent
    // rescan of the same repo reads its baseline AFTER this one persists (see serializePerRepo).
    // G1-05: the throttle check lives INSIDE that same section on purpose — a burst's second run waits
    // for the first to persist, then reads the just-written `scannedAt` and coalesces. Checking outside
    // would race (both reads see the old baseline and both scan), which is exactly the bug being fixed.
    await serializePerRepo(fullName.toLowerCase(), async () => {
      const prev = await getScanReportByCommit(owner, repo, { orgSlug }).catch(() => null);
      if (withinPushRescanWindow(prev?.scannedAt)) {
        // COALESCE, don't queue: we have no background worker (this runs inside the request's after(),
        // bounded by maxDuration), so the push is DROPPED rather than deferred. It is not lost work in
        // the usual case — `scanRepository` always scans the repo's CURRENT default-branch head, so the
        // next push past the window picks up every commit coalesced here in one scan. If pushes stop
        // inside the window, the trailing head is covered by the repo's scheduled autoscan
        // (/api/cron/rescan) or a manual rescan; the report is at most one window + one cadence stale.
        console.info(
          `[webhook] push rescan for ${fullName} coalesced into the scan at ${prev?.scannedAt} (min interval ${pushRescanMinIntervalMs()}ms)`,
        );
        return;
      }
      // ── CREDIT RESERVATION ──────────────────────────────────────────────────────────────────────
      // This is the money gate the header promises, and until now it did not exist: the push rescan
      // ran real LLM inference on a private org repo with no reservation at all, so a watched org at
      // balance zero kept scanning free forever and the 15-minute throttle was the only cost ceiling.
      // Mirrors the queue worker's shape (reserve → skip / refund), because the outcomes are the same
      // ones a background scan has: a webhook cannot 402 anybody.
      //
      // ORDER: the throttle check above runs FIRST, on purpose. The throttle is not a stamp we set —
      // it is derived from the PRIOR PERSISTED SCAN's `scannedAt`, so only a scan that actually ran
      // and persisted moves the window. A push skipped for credits therefore consumes nothing, and a
      // later top-up scans on the very next push instead of waiting out a window it never opened.
      // Checking credits first would only add a ledger read to pushes that were going to coalesce.
      //
      // `mock: false` — this path asks for a real grade (no orgSlug is passed to scanRepository, so it
      // uses the platform provider, never a BYOM key). isMeteredScan still exempts self-hosted, a
      // DB-less deployment and the public org, which is the whole set of not-metered deployments here.
      const metered = isMeteredScan(orgSlug, false);
      // Attribution for BOTH sides of the movement: no human is behind a push delivery, so the honest
      // actor is the path itself, and the refund below names the same actor and repo as the debit.
      const actor = "webhook:push";
      let charged = false;
      if (metered) {
        const reservation = await reserveScanCredit(orgSlug, fullName, { actor });
        if (reservation.skip) {
          // SKIP, don't scan-for-free and don't release the delivery: the balance is exhausted, and a
          // GitHub redelivery would find it exhausted too (releasing would turn an empty wallet into a
          // retry storm). Same "coalesce, don't queue" reasoning as the throttle — the repo is covered
          // by the next push after a top-up, or by its scheduled autoscan.
          //
          // A DURABLE trace, not just a log line. This is the one skip an OWNER has to be able to act
          // on — nobody is watching the response (it was sent before after() ran) and the fix is to buy
          // credits — so it writes the same Repository.lastScanStatus/lastScanError the queue worker
          // writes for its own skips (scan-queue-worker.ts). The Repositories tab already renders that
          // pair, so a watched repo going stale says WHY on the dashboard instead of only in the logs.
          // Best-effort, exactly as everywhere else: a bookkeeping write must not decide the skip.
          await recordScanOutcome(orgSlug, fullName, { ok: false, error: "insufficient credits" }).catch(() => {});
          console.warn(
            `[webhook] push rescan for ${fullName} skipped: insufficient_credits (balance ${reservation.balance ?? "unknown"})`,
          );
          return;
        }
        charged = reservation.reserved; // true only on an overflow DEBIT — a within-allowance scan is free
      }
      // Give the credit back when nothing billable was produced. No-op unless an overflow credit was
      // actually debited; refunding a free scan would MINT one.
      const refundCredit = () => refundScanCredit(orgSlug, charged, { actor, repoFullName: fullName });

      // Every unwind path from here on has to answer "was anything billable produced?". A throw
      // BEFORE a real report (token mint, provider error) produced nothing and releases the delivery
      // for redelivery, so it must refund or every retry buys a second credit; a throw AFTER one keeps
      // the credit, because the inference genuinely ran. Same rule as the worker's `inferenceBilled`.
      let inferenceBilled = false;
      try {
        const token = await getInstallationToken(installationId);
        const report = await scanRepository(fullName, { token });
        inferenceBilled = report.engine?.provider != null && report.engine.provider !== "mock";
        // DEGRADE-TO-MOCK GUARD. This path asks for a real LLM grade; when the provider is down
        // scanRepository still returns a report, stamped engine.provider = "mock" — the deterministic
        // FLOOR, not a measurement. Persisting it makes that floor the repo's current public reading AND
        // the next run's regression baseline, and the alert below would then diff a real prior scan
        // against our own outage and tell the customer their repo regressed. The interactive routes
        // already refuse to store such a report (scan-finalize.ts's `authoritative` gate), and the
        // sibling cron/org-scan routes refund the credit on exactly this condition — as, now, does the
        // reserve above: the degrade is recognised for BOTH the data and the billing here.
        //
        // Deliberately NOT released for redelivery: a provider outage would degrade the retry too, so a
        // release turns one outage into a scan storm. The repo is covered by the next push past the
        // window or its scheduled autoscan — the same "coalesce, don't queue" reasoning as the throttle
        // above.
        // Optional-chained on purpose: a report with no engine stamp (a legacy/reconstructed shape) is
        // not PROVEN degraded, so it persists — fail toward keeping a real scan, never toward dropping one.
        if (report.engine?.provider === "mock") {
          await refundCredit(); // no inference was bought, so the org keeps its credit
          console.warn(
            `[webhook] push rescan for ${fullName} degraded to the deterministic floor (LLM unavailable) — not persisted, credit refunded, no regression alert`,
          );
          return;
        }
        const persisted = await persistScanReport(report, { orgSlug });
        // The shared refund policy, byte-for-byte the worker's: degrade-to-mock (handled above) or a
        // dedup — an unchanged head scored no new row, and "a dedup run is free".
        if (shouldRefundScan({ engine: { provider: report.engine?.provider ?? "" } }, persisted)) {
          await refundCredit();
        }
        if (persisted && !persisted.deduped) {
          const orgId = (await getOrgId(orgSlug).catch(() => null)) ?? undefined;
          await checkAndAlertRegression(prev, report, { orgId, orgSlug });
        }
      } catch (err) {
        if (!inferenceBilled) await refundCredit();
        throw err; // the outer catch owns the delivery release + the log
      }
    });
  } catch (err) {
    // The deferred rescan failed after we already 2xx'd — release the delivery so a redelivery retries.
    await abandonDelivery(deliveryId, () =>
      console.error("[webhook] push rescan failed", err instanceof Error ? err.message : err),
    );
  }
}

/**
 * Apply an installation lifecycle event:
 *   • created   → confirm + upsert mapping.
 *   • unsuspend → confirm + upsert mapping, then RESUME the paused schedules.
 *   • suspend   → GitHub-confirm + NON-destructive pause (suspendInstallation).
 *   • deleted   → GitHub-confirm + cascading teardown (removeInstallation).
 *
 * github-app-installation-webhooks #1: `suspend` is a REVERSIBLE pause (billing lapse / admin toggle),
 * but it used to run the SAME full removeInstallation cascade as a permanent `deleted` — unwatching
 * every repo, setting scanSchedule "off", nulling githubInstallId, and revoking sessions — while
 * `unsuspend` only re-ran upsertInstallation and never re-watched anything. So a temporary suspension
 * silently destroyed the org's entire auto-rescan configuration forever. Now suspend PAUSES (keeps
 * watch/cadence/install id, only clears nextScanAt) and unsuspend RESUMES; the full teardown is reserved
 * for the genuine `deleted` case.
 *
 * github-app-installation-webhooks #2: this work does a GitHub round-trip (getInstallation /
 * confirmRevocationWithGitHub) AND multi-table DB writes. Running it SYNCHRONOUSLY before the 2xx risked
 * GitHub's ~10s webhook timeout on a slow API/DB and let a timed-out original race its redelivery
 * concurrently. Moved to after() like the scan/reconcile paths so the webhook acks fast; signature-verify
 * + dedup still run BEFORE after() in POST. The same forget-on-failure net keeps a transient failure
 * retryable via redelivery.
 */
async function runInstallationLifecycle(
  id: number,
  action: "created" | "unsuspend" | "deleted" | "suspend",
  deliveryId?: string,
) {
  try {
    if (action === "created" || action === "unsuspend") {
      // Don't trust the payload's claimed account for a token-minting mapping: a forged-but-signed
      // delivery could name a victim login for the attacker's installation id. Confirm the real
      // account from GitHub (App-JWT authoritative) and store THAT, not the payload.
      try {
        const info = await getInstallation(id);
        await upsertInstallation({ login: info.account, installationId: id });
        // unsuspend lifts a reversible pause — re-arm the schedules suspend paused (suspend keeps
        // watch + cadence and only clears nextScanAt, so this marks the watched repos due again).
        // `created` has nothing to resume, so this branch is unsuspend-only.
        if (action === "unsuspend") await resumeInstallation(id);
      } catch (err) {
        // The install was NOT persisted (transient GitHub/DB failure). The delivery was already marked
        // seen, so without this release GitHub's redelivery — the only retry — would be deduped and the
        // installation silently never recorded (broken /connect, every scan falling back to public).
        await abandonDelivery(deliveryId, () =>
          console.warn(
            `[webhook] could not confirm installation ${id}; skipping ${action}`,
            err instanceof Error ? err.message : err,
          ),
        );
      }
    } else if (action === "suspend") {
      // REVERSIBLE pause, not a permanent revocation — confirm with GitHub (symmetric with delete),
      // then PAUSE WITHOUT DESTROYING: keep watch flags, per-repo schedules, and the install id, only
      // clearing nextScanAt so the cron stops (and stops minting doomed 401 tokens). An `unsuspend`
      // then resumes via resumeInstallation. The GitHub confirm blocks a forged/misrouted but signed
      // suspend naming a victim's still-active installation.
      if (await confirmRevocationWithGitHub(id, action)) {
        await suspendInstallation(id);
      } else {
        await abandonDelivery(deliveryId, () =>
          console.warn(`[webhook] ignoring unconfirmed installation suspend for id ${id}`),
        );
      }
    } else {
      // deleted: a genuine permanent revocation. Destructive + cascading (removeInstallation unwatches
      // every repo, nulls the install id, and revokes live sessions), so confirm with GitHub before
      // acting — symmetric with the create branch above. This blocks a forged/misrouted but signed
      // delete naming a victim's still-active installation from silently disabling their scanning.
      if (await confirmRevocationWithGitHub(id, action)) {
        await removeInstallation(id);
      } else {
        // "Unconfirmed" covers two cases confirmRevocationWithGitHub can't distinguish: a forged
        // delivery (GitHub still has the installation — replaying re-runs only the confirm and refuses
        // again, no state change) and a TRANSIENT confirm failure on a genuine uninstall. Release the
        // delivery so the genuine case stays retryable; the security control is the GitHub confirm gate.
        await abandonDelivery(deliveryId, () =>
          console.warn(`[webhook] ignoring unconfirmed installation ${action} for id ${id}`),
        );
      }
    }
  } catch (err) {
    // The deferred lifecycle failed after we already 2xx'd — release the delivery so a redelivery retries.
    await abandonDelivery(deliveryId, () =>
      console.error("[webhook] installation lifecycle failed", err instanceof Error ? err.message : err),
    );
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  // Reject replays of an already-processed delivery (a verified signature alone can't distinguish a fresh
  // delivery from a re-sent capture). Two-level dedup: the in-memory Map is a fast first-level filter for
  // SAME-instance replays; the DB claim (claimWebhookDelivery) is the AUTHORITATIVE cross-instance check —
  // on a horizontally-scaled / serverless deploy each instance's Map starts empty, so process-local dedup
  // alone is near-useless against a replay routed to another instance (#3). The claim is released on a
  // deferred-processing failure (forgetDelivery) so a genuine redelivery still retries. Answer 200 so a
  // genuine GitHub redelivery of a duplicate isn't retried.
  // Parse BEFORE claiming (github-app-installation-webhooks 07-16 #4): the body is already in memory
  // and signature-verified, and a parse failure must not consume the delivery's claim — the 400 used to
  // land AFTER the claim with no release, so the id stayed claimed for the 24h horizon and GitHub's
  // retry of the 400 was answered `duplicate: true`: the event dropped forever with an audit trail
  // saying everything worked.
  let payload: WebhookPayload = {};
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const delivery = request.headers.get("x-github-delivery");
  if (delivery) {
    const seenLocally = deliveryAlreadySeen(delivery);
    let claimed: boolean;
    try {
      claimed = seenLocally ? false : await claimWebhookDelivery(delivery, REPLAY_HORIZON_MS);
    } catch (err) {
      // The DB claim threw (a blip, not a verdict). deliveryAlreadySeen() already recorded the id in
      // the in-memory Map optimistically — roll that back, or this instance would short-circuit
      // GitHub's redelivery as `duplicate: true` for a delivery that was never claimed nor processed
      // (the same silent-loss the forgetDelivery release-net exists to prevent). Answer 500 so GitHub
      // retries a delivery that nothing has claimed.
      forgetLocalDelivery(delivery);
      console.error("[webhook] delivery claim failed", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Delivery claim failed." }, { status: 500 });
    }
    if (!claimed) {
      return NextResponse.json({ ok: true, event, duplicate: true });
    }
  }

  try {
    if (event === "installation") {
      const id = payload.installation?.id;
      const action = payload.action;
      // Defer the heavy lifecycle work (GitHub confirm round-trip + cascading DB writes) to after()
      // so the webhook acks fast (github-app-installation-webhooks #2) — signature-verify + dedup
      // already ran above, before this point. Pass the delivery id so a transient failure releases the
      // dedup slot for a redelivery retry.
      if (
        id != null &&
        (action === "created" || action === "unsuspend" || action === "deleted" || action === "suspend")
      ) {
        after(() => runInstallationLifecycle(id, action, delivery ?? undefined));
      }
    } else if (event === "installation_repositories" && isDbConfigured()) {
      // The user changed WHICH repos an installation can see (Add/Remove on GitHub's Configure page).
      const id = payload.installation?.id;
      // Deliberately NO payload-trusting fast path here: a valid signature proves authenticity, not
      // freshness/ownership, so acting on `repositories_removed` verbatim would let a forged/misrouted
      // but signed delivery name a victim's installation id and silently unwatch their actively-watched
      // repos — destructive, and the reconcile below never re-watches (added repos stay opt-in), so the
      // damage wouldn't self-heal. Destructive webhook actions must be GitHub-confirmed (the same
      // discipline as confirmRevocationWithGitHub on delete/suspend): the deferred reconcile re-lists
      // the installation's live repos from GitHub and unwatches only what GitHub confirms is gone. It
      // runs in this same request's after(), so legitimate quiescing is barely delayed, and it also
      // catches changes the payload doesn't itemize (a "selected → all" flip, paginated narrowing).
      if (id != null && isAppConfigured()) {
        after(() => reconcileInstallationRepos(id, delivery ?? undefined));
      }
    } else if (event === "pull_request" && isAppConfigured()) {
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const prNumber = payload.pull_request?.number;
      const headSha = payload.pull_request?.head?.sha;
      const baseRef = payload.pull_request?.base?.ref ?? payload.repository?.default_branch;
      if (installationId && owner && repo && prNumber && headSha && baseRef && PR_ACTIONS.has(payload.action ?? "")) {
        // Defer the scan to after the response so GitHub gets its fast 2xx. Pass the delivery id so a
        // transient failure in the deferred gate releases the dedup slot for a redelivery retry.
        after(() =>
          runPrGate({ installationId, owner, repo, prNumber, headSha, baseRef }, webhookGateHooks(delivery ?? undefined)),
        );
      }
      // MOONSHOT #1 — a MERGED close is the evidence moment for the AI-change population, and it is
      // not a gate action (a merged PR needs no check run), so it sits beside the gate rather than
      // inside its condition. `after()` so the ack stays fast; failures are swallowed inside the
      // reducer — a missed row is picked up by the next scan, and must never fail a delivery.
      if (owner && payload.action === "closed" && isDbConfigured()) {
        const slug = owner.toLowerCase();
        after(() => reduceAiChangeEvent(slug, "pull_request", payload));
      }
    } else if (event === "pull_request_review" && isDbConfigured()) {
      // MOONSHOT #1 — an approving human review is THE control the conformance pack evidences, and
      // this is the only path that observes it within seconds rather than at the next scan's cadence.
      // Deliberately NOT gated on isAppConfigured(): it writes no check run and mints no token, it
      // only records what the signed delivery already told us.
      const owner = payload.repository?.owner?.login;
      if (owner) {
        const slug = owner.toLowerCase();
        after(() => reduceAiChangeEvent(slug, "pull_request_review", payload));
      }
    } else if (event === "check_run" && isAppConfigured()) {
      // A "Re-run" button click (requested_action with our identifier) or GitHub's native
      // rerequested — re-evaluate the gate for the PR the run is attached to, without a new push.
      const isRerun =
        payload.action === "rerequested" ||
        (payload.action === "requested_action" && payload.requested_action?.identifier === "rescan");
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const cr = payload.check_run;
      const pr = cr?.pull_requests?.[0];
      const headSha = cr?.head_sha;
      const prNumber = pr?.number;
      const baseRef = pr?.base?.ref ?? payload.repository?.default_branch;
      if (isRerun && installationId && owner && repo && prNumber && headSha && baseRef) {
        after(() =>
          runPrGate({ installationId, owner, repo, prNumber, headSha, baseRef }, webhookGateHooks(delivery ?? undefined)),
        );
      }
    } else if (event === "push" && isAppConfigured() && isDbConfigured()) {
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const defaultBranch = payload.repository?.default_branch;
      const onDefault = defaultBranch != null && payload.ref === `refs/heads/${defaultBranch}`;
      const headMoved = !payload.deleted && !!payload.after && !/^0+$/.test(payload.after);
      if (installationId && owner && repo && onDefault && headMoved) {
        after(() => runPushRescan(installationId, owner, repo, delivery ?? undefined));
      }
    } else if (REPO_CONTROL_EVENTS.has(event) && isAppConfigured() && isDbConfigured()) {
      // A repo-scoped control change (protection rule, ruleset, or the repo itself being renamed /
      // archived / made private). Enqueue a FREE probe — no credit, no inference — which re-reads the
      // truth from GitHub rather than believing the delivery.
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const fullName = payload.repository?.full_name;
      if (installationId && owner && fullName) {
        const login = owner;
        after(async () => {
          await enqueueControlProbe(installationId, login, fullName, event, delivery ?? undefined);
          // MOONSHOT #1 — and, separately, record WHO. The probe re-reads the truth; only the
          // delivery knows the actor, and the attribution row asserts no state of its own.
          if (GOVERNANCE_EVENTS.includes(event)) {
            await recordControlAttribution(login.toLowerCase(), fullName, event, payload, delivery ?? undefined);
          }
        });
      }
    } else if (ORG_CONTROL_EVENTS.has(event) && isAppConfigured() && isDbConfigured()) {
      // An owner-level change (`member`, `team`). Deliberately enqueue-only and membership-blind: this
      // writes NO membership or RBAC row of its own (that is deck item #21, not this lane) — it only
      // says "this org's access shape moved, go re-observe the controls".
      const installationId = payload.installation?.id;
      const owner = payload.organization?.login ?? payload.repository?.owner?.login;
      const repoFullName = payload.repository?.full_name;
      if (installationId && owner) {
        const login = owner;
        after(() =>
          repoFullName
            ? enqueueControlProbe(installationId, login, repoFullName, event, delivery ?? undefined)
            : enqueueOrgControlProbes(installationId, login, event, delivery ?? undefined),
        );
      }
    }
  } catch (err) {
    // Still 200 so GitHub doesn't endlessly retry on our transient DB issues — but release the
    // delivery from the seen-set so a GitHub/manual REDELIVERY isn't deduped: the synchronous work
    // (installation upsert/removal, repo unwatch) did NOT complete, and dedup must mean
    // "successfully processed", not merely "HTTP acknowledged".
    await abandonDelivery(delivery ?? undefined, () => console.error("[app/webhook] handler error", err));
  }

  return NextResponse.json({ ok: true, event });
}
