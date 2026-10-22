// The installation lifecycle and the installation_repositories reconcile, moved verbatim from
// src/app/api/app/webhook/route.ts (challenge-2026-10-22d github-app-0). Both arms are bound by
// GitHub itself rather than by the payload's owner: every write is keyed by the installation id and
// follows a GitHub (App-JWT) read - getInstallation for created/unsuspend, confirmRevocationWithGitHub
// for suspend/deleted, and the live repo listing for the reconcile.

import { getInstallation, listInstallationReposResult } from "@/lib/github/app";
import { reconcileWatchedRepos, removeInstallation, resumeInstallation, suspendInstallation, upsertInstallation } from "@/lib/db";
// Row 35: newly granted repos enter the watchlist off the same complete live listing.
import { applyGrantedAutoWatch, planGrantedAutoWatch } from "@/lib/db/install-grants";
import { abandonDelivery } from "@/lib/github/webhook-delivery";
import { confirmRevocationWithGitHub } from "./owner-bind";

/**
 * Reconcile the DB watch state against an installation's CURRENT accessible repos. Re-lists the live
 * set from GitHub and drops watch for any watched repo no longer in it - catching access changes the
 * webhook payload doesn't itemize as explicit "removed" rows (a "selected -> all" flip, a paginated
 * "all -> selected" narrowing). Best-effort + deferred: a listing failure SKIPS (so a transient GitHub
 * error can't be misread as "zero repos" and wipe the whole watch set); a later event re-reconciles.
 *
 * The same complete listing also WATCHES repos newly granted to the installation (row 35): for an org
 * that already runs a watchlist, a live name the org has no row for is watched through the import
 * path, capped per event, with the overflow logged + audited. The rules live in @/lib/db/install-grants.
 */
export async function reconcileInstallationRepos(installationId: number, deliveryId?: string) {
  try {
    // "reconcile" depth (row 14): up to 500 pages under a 180 s budget, so a >5000-repo installation
    // can complete a listing instead of being skipped forever by the interactive 50-page cap.
    const { repos: live, truncated } = await listInstallationReposResult(installationId, "reconcile");
    // BUG (github-app-installation-webhooks #1): reconcileWatchedRepos' contract is "only pass a
    // COMPLETE live set" - it unwatches anything NOT in the set. A capped (truncated) listing is
    // a silently-incomplete success, so passing it would unwatch every watched repo past the cap on
    // a large installation. Apply the same "fail-safe, don't wipe" discipline as the throwing path:
    // SKIP the destructive reconcile when the listing was incomplete; a later event re-reconciles.
    if (truncated) {
      console.warn(
        `[webhook] installation ${installationId}: repo listing truncated (incomplete); skipping watch reconcile to avoid unwatching repos past the listing bound`,
      );
      return;
    }
    // Planned BEFORE the unwatch, so "the org runs a watchlist" is judged on the state the user changed
    // (an {a} -> {b} swap would otherwise read as an emptied watchlist and grant nothing).
    const grants = await planGrantedAutoWatch(installationId, live);
    const dropped = await reconcileWatchedRepos(
      installationId,
      live.map((r) => r.fullName),
    );
    if (dropped > 0) {
      console.warn(`[webhook] installation ${installationId}: unwatched ${dropped} repo(s) no longer accessible`);
    }
    const granted = await applyGrantedAutoWatch(installationId, grants);
    for (const g of granted) {
      if (g.watched.length > 0) {
        console.warn(`[webhook] installation ${installationId}: auto-watched ${g.watched.length} newly granted repo(s) for ${g.orgSlug}`);
      }
    }
  } catch (err) {
    // The deferred reconcile failed after we already 2xx'd - release the delivery so a redelivery
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

/**
 * Apply an installation lifecycle event:
 *   • created   -> confirm + upsert mapping.
 *   • unsuspend -> confirm + upsert mapping, then RESUME the paused schedules.
 *   • suspend   -> GitHub-confirm + NON-destructive pause (suspendInstallation).
 *   • deleted   -> GitHub-confirm + cascading teardown (removeInstallation).
 *
 * github-app-installation-webhooks #1: `suspend` is a REVERSIBLE pause (billing lapse / admin toggle),
 * but it used to run the SAME full removeInstallation cascade as a permanent `deleted` - unwatching
 * every repo, setting scanSchedule "off", nulling githubInstallId, and revoking sessions - while
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
export async function runInstallationLifecycle(
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
        // unsuspend lifts a reversible pause - re-arm the schedules suspend paused (suspend keeps
        // watch + cadence and only clears nextScanAt, so this marks the watched repos due again).
        // `created` has nothing to resume, so this branch is unsuspend-only.
        if (action === "unsuspend") await resumeInstallation(id);
      } catch (err) {
        // The install was NOT persisted (transient GitHub/DB failure). The delivery was already marked
        // seen, so without this release GitHub's redelivery - the only retry - would be deduped and the
        // installation silently never recorded (broken /connect, every scan falling back to public).
        await abandonDelivery(deliveryId, () =>
          console.warn(
            `[webhook] could not confirm installation ${id}; skipping ${action}`,
            err instanceof Error ? err.message : err,
          ),
        );
      }
    } else if (action === "suspend") {
      // REVERSIBLE pause, not a permanent revocation - confirm with GitHub (symmetric with delete),
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
      // acting - symmetric with the create branch above. This blocks a forged/misrouted but signed
      // delete naming a victim's still-active installation from silently disabling their scanning.
      if (await confirmRevocationWithGitHub(id, action)) {
        await removeInstallation(id);
      } else {
        // "Unconfirmed" covers two cases confirmRevocationWithGitHub can't distinguish: a forged
        // delivery (GitHub still has the installation - replaying re-runs only the confirm and refuses
        // again, no state change) and a TRANSIENT confirm failure on a genuine uninstall. Release the
        // delivery so the genuine case stays retryable; the security control is the GitHub confirm gate.
        await abandonDelivery(deliveryId, () =>
          console.warn(`[webhook] ignoring unconfirmed installation ${action} for id ${id}`),
        );
      }
    }
  } catch (err) {
    // The deferred lifecycle failed after we already 2xx'd - release the delivery so a redelivery retries.
    await abandonDelivery(deliveryId, () =>
      console.error("[webhook] installation lifecycle failed", err instanceof Error ? err.message : err),
    );
  }
}
