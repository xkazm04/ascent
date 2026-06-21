// POST /api/app/webhook — GitHub App events. Verifies the HMAC signature, then:
//   • installation events                      → keep stored installations in sync.
//   • pull_request (opened/synced/reopened)    → run the maturity gate on the repo and post a
//                                                Check Run + sticky PR comment (Feature 2).
//   • push (to the default branch, head moved) → re-scan a watched repo and alert on a
//                                                regression vs the prior scan (Feature 4).
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
  getInstallationIdForOwner,
  getOrgGatePolicy,
  getOrgId,
  getScanReportByCommit,
  isDbConfigured,
  isRepoWatched,
  persistScanReport,
  reconcileWatchedRepos,
  removeInstallation,
  reportPermalink,
  upsertInstallation,
} from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { evaluateGate } from "@/lib/scoring/gate";
import { buildGateComment, GATE_COMMENT_MARKER } from "@/lib/scoring/gate-comment";
import { createCheckRun, upsertStickyComment } from "@/lib/github/checks";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { diffReports } from "@/lib/scoring/engine";

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
  before?: string;
  deleted?: boolean;
  // installation_repositories event: repos added/removed from an installation's selected access.
  repositories_added?: { full_name?: string }[];
  repositories_removed?: { full_name?: string }[];
  repository_selection?: string;
  // check_run event: a "Re-run" button click (requested_action) or GitHub's rerequested.
  check_run?: { head_sha?: string; pull_requests?: { number?: number; base?: { ref?: string } }[] };
  requested_action?: { identifier?: string };
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

/** The "Re-run" button surfaced on the gate Check Run — clicking it re-delivers a check_run webhook. */
const RERUN_ACTION = [{ label: "Re-run", description: "Re-evaluate this PR's maturity", identifier: "rescan" }];

// Replay defense. GitHub stamps each delivery with a unique X-GitHub-Delivery id. A captured,
// still-valid signed request can be re-sent (the HMAC still verifies) to re-trigger scans/gates;
// remember recently-seen ids (bounded, in-memory) and skip duplicates. Process-local — it collapses
// same-instance replays; recorded only AFTER signature verification so junk can't fill the map.
const DELIVERY_TTL_MS = 10 * 60_000;
const DELIVERY_MAX = 2000;
const seenDeliveries = new Map<string, number>(); // delivery id -> expiry

function deliveryAlreadySeen(id: string): boolean {
  const now = Date.now();
  const exp = seenDeliveries.get(id);
  if (exp && exp > now) return true;
  seenDeliveries.set(id, now + DELIVERY_TTL_MS);
  if (seenDeliveries.size > DELIVERY_MAX) {
    for (const [k, v] of seenDeliveries) if (v <= now) seenDeliveries.delete(k);
    while (seenDeliveries.size > DELIVERY_MAX) {
      const oldest = seenDeliveries.keys().next().value;
      if (oldest === undefined) break;
      seenDeliveries.delete(oldest);
    }
  }
  return false;
}

/**
 * Release a delivery id from the seen-set so a redelivery can be retried. The handler marks a delivery
 * seen at the top (replay protection) BEFORE the deferred after() scan runs; if that scan then fails
 * transiently (DB blip, token mint failure), the delivery would stay "seen" and a GitHub/manual
 * redelivery of the same id would be silently deduped — dropping the scan forever. Calling this in the
 * deferred work's failure path frees the slot so the retry actually runs. (Process-local, like the map.)
 */
function forgetDelivery(id: string): void {
  seenDeliveries.delete(id);
}

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
    }
    return matches;
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

function publicBase(): string {
  return (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
}

interface PrGateRef {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  /** PR head commit SHA — what the check is attached to AND the ref we score. */
  headSha: string;
  /** PR base branch (e.g. "main") — the ref we diff against to show the PR's impact. */
  baseRef: string;
  /** GitHub delivery id, released from the seen-set if this deferred run fails so a redelivery retries. */
  deliveryId?: string;
}

/**
 * Run the maturity gate for a PR. Scores the PR's **head** (so adding tests / a CLAUDE.md / CI in
 * the PR actually moves the gate), diffs it against the **base** branch to show what the PR
 * changes, and posts a Check Run (the merge status) + a sticky comment. Deterministic (mock) so
 * it's fast and free of LLM spend; both scans use the same engine + token, so the diff is clean.
 */
async function runPrGate(ref: PrGateRef) {
  const { installationId, owner, repo, prNumber, headSha, baseRef } = ref;
  // Hoisted so the catch can post a neutral check on the SAME token when a failure happens after mint.
  let token: string | undefined;
  try {
    if (!(await installationMatchesOwner(installationId, owner))) return;
    token = await getInstallationToken(installationId);
    const fullName = `${owner}/${repo}`;

    // Score the PR head. A fork PR's head commit can be unreachable via the base repo's tree API —
    // fall back to the default branch so the check still posts (just without per-PR resolution).
    let headReport;
    let scoredHead = true;
    try {
      headReport = await scanRepository(fullName, { mock: true, token, ref: headSha });
    } catch (err) {
      console.warn("[webhook] head-ref scan failed, falling back to default branch", err instanceof Error ? err.message : err);
      headReport = await scanRepository(fullName, { mock: true, token });
      scoredHead = false;
    }
    // Honor the org's persisted gate policy (GATE-1) — the App check previously ignored any configured
    // bar and always used archetype defaults. Falls back to the default when unset/DB-less.
    const policy = (await getOrgGatePolicy(owner).catch(() => null)) ?? undefined;
    const gate = evaluateGate(headReport, policy);

    // Diff base → head to show the PR's impact. Only meaningful when we actually scored the head
    // ref; both scans are mock at two refs, so the delta reflects the PR's tree changes alone.
    let baseline = null;
    if (scoredHead) {
      const baseReport = await scanRepository(fullName, { mock: true, token, ref: baseRef }).catch(() => null);
      if (baseReport) baseline = diffReports(baseReport, headReport);
    }

    const comment = buildGateComment(headReport, gate, baseline, { baselineSuffix: "in this PR" });
    const detailsUrl = publicBase() + reportPermalink(fullName, headReport.repo.headSha);

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
    }).catch((err) => console.error("[webhook] check-run failed", err instanceof Error ? err.message : err));

    await upsertStickyComment({ token, owner, repo, prNumber, marker: GATE_COMMENT_MARKER, body: comment.commentBody }).catch(
      (err) => console.error("[webhook] sticky comment failed", err instanceof Error ? err.message : err),
    );
  } catch (err) {
    console.error("[webhook] PR gate failed", err instanceof Error ? err.message : err);
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
      }).catch((e) => console.error("[webhook] neutral check failed", e instanceof Error ? e.message : e));
    }
    // The deferred gate failed after we already 2xx'd — release the delivery so a redelivery retries.
    if (ref.deliveryId) forgetDelivery(ref.deliveryId);
  }
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
    console.warn(
      `[webhook] installation_repositories reconcile failed for ${installationId}`,
      err instanceof Error ? err.message : err,
    );
    // The deferred reconcile failed after we already 2xx'd — release the delivery so a redelivery
    // retries (same net as runPrGate/runPushRescan); otherwise a transient listing failure dedupes
    // the redelivery and the access change is lost until some later event happens to re-reconcile.
    if (deliveryId) forgetDelivery(deliveryId);
  }
}

/** Re-scan a watched repo on push, persist, and alert on a regression vs the prior scan. */
async function runPushRescan(installationId: number, owner: string, repo: string, deliveryId?: string) {
  try {
    const fullName = `${owner}/${repo}`;
    const orgSlug = owner.toLowerCase();
    if (!(await installationMatchesOwner(installationId, owner))) return;
    if (!(await isRepoWatched(orgSlug, fullName))) return; // only watched repos auto-rescan
    const token = await getInstallationToken(installationId);
    const prev = await getScanReportByCommit(owner, repo, { orgSlug }).catch(() => null);
    const report = await scanRepository(fullName, { token });
    const persisted = await persistScanReport(report, { orgSlug });
    if (persisted && !persisted.deduped) {
      const orgId = (await getOrgId(orgSlug).catch(() => null)) ?? undefined;
      await checkAndAlertRegression(prev, report, { orgId, orgSlug });
    }
  } catch (err) {
    console.error("[webhook] push rescan failed", err instanceof Error ? err.message : err);
    // The deferred rescan failed after we already 2xx'd — release the delivery so a redelivery retries.
    if (deliveryId) forgetDelivery(deliveryId);
  }
}

/**
 * Apply an installation lifecycle event (created/unsuspend → confirm + upsert mapping;
 * deleted/suspend → GitHub-confirm + cascading removeInstallation).
 *
 * BUG (github-app-installation-webhooks #2): this work does a GitHub round-trip (getInstallation /
 * confirmRevocationWithGitHub) AND a multi-table cascade (removeInstallation → repos updateMany +
 * orgs updateMany + per-org bumpSessionVersion). Running it SYNCHRONOUSLY before the 2xx risked
 * GitHub's ~10s webhook timeout on a slow API/DB and let a timed-out original race its redelivery
 * through the full cascade concurrently. Moved to after() like the scan/reconcile paths so the
 * webhook acks fast; signature-verify + dedup still run BEFORE after() in POST. The same
 * forget-on-failure net keeps a transient failure retryable via redelivery.
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
      } catch (err) {
        console.warn(
          `[webhook] could not confirm installation ${id}; skipping upsert`,
          err instanceof Error ? err.message : err,
        );
        // The install was NOT persisted (transient GitHub/DB failure). The delivery was already marked
        // seen, so without this release GitHub's redelivery — the only retry — would be deduped and the
        // installation silently never recorded (broken /connect, every scan falling back to public).
        if (deliveryId) forgetDelivery(deliveryId);
      }
    } else {
      // Destructive + cascading (removeInstallation unwatches every repo, nulls the install id, and
      // revokes live sessions), so confirm with GitHub before acting — symmetric with the create
      // branch above. This blocks a forged/misrouted but signed delete/suspend naming a victim's
      // still-active installation from silently disabling their scanning and signing them out.
      if (await confirmRevocationWithGitHub(id, action)) {
        await removeInstallation(id);
      } else {
        console.warn(`[webhook] ignoring unconfirmed installation ${action} for id ${id}`);
        // "Unconfirmed" covers two cases confirmRevocationWithGitHub can't distinguish: a forged
        // delivery (GitHub still has the installation — replaying re-runs only the confirm and refuses
        // again, no state change) and a TRANSIENT confirm failure on a genuine uninstall. Release the
        // delivery so the genuine case stays retryable; the security control is the GitHub confirm gate.
        if (deliveryId) forgetDelivery(deliveryId);
      }
    }
  } catch (err) {
    console.error("[webhook] installation lifecycle failed", err instanceof Error ? err.message : err);
    // The deferred lifecycle failed after we already 2xx'd — release the delivery so a redelivery retries.
    if (deliveryId) forgetDelivery(deliveryId);
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  // Reject replays of an already-processed delivery (a verified signature alone can't distinguish a
  // fresh delivery from a re-sent capture). Answer 200 so a genuine GitHub redelivery isn't retried.
  const delivery = request.headers.get("x-github-delivery");
  if (delivery && deliveryAlreadySeen(delivery)) {
    return NextResponse.json({ ok: true, event, duplicate: true });
  }
  let payload: WebhookPayload = {};
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
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
        after(() => runPrGate({ installationId, owner, repo, prNumber, headSha, baseRef, deliveryId: delivery ?? undefined }));
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
        after(() => runPrGate({ installationId, owner, repo, prNumber, headSha, baseRef, deliveryId: delivery ?? undefined }));
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
    console.error("[app/webhook] handler error", err);
    // Still 200 so GitHub doesn't endlessly retry on our transient DB issues — but release the
    // delivery from the seen-set so a GitHub/manual REDELIVERY isn't deduped: the synchronous work
    // (installation upsert/removal, repo unwatch) did NOT complete, and dedup must mean
    // "successfully processed", not merely "HTTP acknowledged".
    if (delivery) forgetDelivery(delivery);
  }

  return NextResponse.json({ ok: true, event });
}
