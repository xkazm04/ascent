// POST /api/app/webhook — GitHub App events. Verifies the HMAC signature, then:
//   • installation events                      → keep stored installations in sync.
//   • pull_request (opened/synced/reopened)    → run the maturity gate on the repo and post a
//                                                Check Run + sticky PR comment (Feature 2).
//   • push (to the default branch, head moved) → re-scan a watched repo and alert on a
//                                                regression vs the prior scan (Feature 4), throttled to
//                                                one paid scan per repo per PUSH_RESCAN_MIN_INTERVAL_MINUTES.
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
  persistScanReport,
  reconcileWatchedRepos,
  removeInstallation,
  resumeInstallation,
  suspendInstallation,
  upsertInstallation,
} from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { abandonDelivery, deliveryAlreadySeen, forgetLocalDelivery } from "@/lib/github/webhook-delivery";
// The PR gate itself now lives in @/lib/github/pr-gate so the org gate-policy sweep can re-run the
// SAME check-writing path (a route file may only export the HTTP-method / segment-config names, so
// it could not be shared from here). This route still owns the replay/dedup machinery and injects
// it as hooks — behavior is unchanged.
import { runPrGate, type PrGateHooks } from "@/lib/github/pr-gate";
import { checkAndAlertRegression } from "@/lib/scan-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface WebhookPayload {
  action?: string;
  installation?: { id: number; account?: { login?: string } };
  repository?: { full_name?: string; name?: string; default_branch?: string; owner?: { login?: string } };
  pull_request?: { number?: number; head?: { sha?: string; ref?: string }; base?: { ref?: string } };
  ref?: string;
  after?: string;
  deleted?: boolean;
  // check_run event: a "Re-run" button click (requested_action) or GitHub's rerequested.
  check_run?: { head_sha?: string; pull_requests?: { number?: number; base?: { ref?: string } }[] };
  requested_action?: { identifier?: string };
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

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
      const token = await getInstallationToken(installationId);
      const report = await scanRepository(fullName, { token });
      const persisted = await persistScanReport(report, { orgSlug });
      if (persisted && !persisted.deduped) {
        const orgId = (await getOrgId(orgSlug).catch(() => null)) ?? undefined;
        await checkAndAlertRegression(prev, report, { orgId, orgSlug });
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
