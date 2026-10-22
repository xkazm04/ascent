// The webhook's ONE installation -> owner bind (challenge-2026-10-22d github-app-0).
//
// A valid HMAC proves a delivery is authentic, not that its (installation, owner) pair is real. Every
// arm that writes tenant state therefore takes a `BoundDelivery`, and the only way to get one is
// `bindDelivery` below: a refused bind logs, releases the delivery once, and returns null, so the arm
// has nothing to write with. The two bind functions and the revocation confirm moved here verbatim
// from src/app/api/app/webhook/route.ts.

import { AppApiError, getInstallation } from "@/lib/github/app";
import { getInstallationIdForOwner, upsertInstallation } from "@/lib/db";
import { abandonDelivery } from "@/lib/github/webhook-delivery";

declare const BOUND: unique symbol;

/** A delivery whose installation is proven to own `orgSlug`. Branded: only `bindDelivery` mints one. */
export interface BoundDelivery {
  readonly installationId: number;
  readonly orgSlug: string;
  readonly deliveryId?: string;
  readonly [BOUND]: true;
}

/**
 * - `stored-or-github`: the stored mapping must agree; an owner with no mapping is confirmed live with
 *   GitHub (App-JWT) and the confirmed pairing persisted. The arms that mint a token use this.
 * - `stored-only`: the stored mapping must agree, and no mapping is a refusal. No GitHub call, no
 *   token: the AI-change arms record evidence for orgs that already hold this installation.
 */
export type BindMode = "stored-or-github" | "stored-only";

/** Bind a webhook's claimed installation to its owner before we mint a token / scan. For a KNOWN
 *  owner, the stored mapping must agree. For an UNKNOWN owner (no mapping yet), the HMAC proves the
 *  delivery is authentic but NOT that a forged/replayed payload's (installationId, owner) pair is
 *  real - so confirm with GitHub (App-JWT authoritative) that the installation actually belongs to
 *  the claimed owner, and fail closed if we can't. */
export async function installationMatchesOwner(installationId: number, owner: string): Promise<boolean> {
  return matchOwner(installationId, owner, "stored-or-github");
}

async function matchOwner(installationId: number, owner: string, mode: BindMode): Promise<boolean> {
  let known: string | null;
  try {
    known = await getInstallationIdForOwner(owner);
  } catch (err) {
    // A DB error must NOT collapse "no mapping exists" and "couldn't determine if a mapping exists"
    // into the same value - that would silently downgrade the strict stored-id match to the looser
    // GitHub-confirmation path whenever the lookup hiccupped. Fail closed.
    console.warn(`[webhook] owner-mapping lookup failed for ${owner}; failing closed`, err instanceof Error ? err.message : err);
    return false;
  }
  if (known) {
    if (known !== String(installationId)) {
      console.warn(`[webhook] installation mismatch for ${owner}: payload=${installationId} stored=${known}; skipping`);
      return false;
    }
    return true;
  }
  if (mode === "stored-only") {
    console.warn(`[webhook] no stored installation mapping for ${owner}; refusing a stored-only bind`);
    return false;
  }
  try {
    const info = await getInstallation(installationId);
    if (info.account.toLowerCase() !== owner.toLowerCase()) {
      console.warn(`[webhook] installation ${installationId} account ${info.account} != payload owner ${owner}; skipping`);
      return false;
    }
    // Persist the GitHub-confirmed (owner -> installation) pairing so later events for this owner take
    // the stored-mapping path. Best-effort: a write failure must not block work that already confirmed.
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
    console.warn(`[webhook] could not confirm installation ${installationId} for ${owner}; skipping`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * The one door to a `BoundDelivery`. A missing installation id or a refused match logs loudly,
 * releases the delivery (a `false` can be a transient blip, so a redelivery may retry) and returns
 * null. `owner` is passed to the match as given; the bound `orgSlug` is its lower-cased form.
 */
export async function bindDelivery(
  installationId: number | undefined,
  owner: string,
  deliveryId: string | undefined,
  mode: BindMode = "stored-or-github",
): Promise<BoundDelivery | null> {
  const ok = installationId != null && (await matchOwner(installationId, owner, mode));
  if (!ok) {
    await abandonDelivery(deliveryId, () =>
      console.warn(`[webhook] refused: installation ${installationId ?? "(none)"} is not bound to ${owner}; nothing written`),
    );
    return null;
  }
  return { installationId, orgSlug: owner.toLowerCase(), deliveryId } as BoundDelivery;
}

/**
 * Confirm a DESTRUCTIVE installation event against GitHub (App-JWT authoritative) before acting on it.
 * A validly-signed but forged/misrouted `installation.deleted`/`suspend` naming a VICTIM's still-active
 * installation id would otherwise wipe their watch/schedule, null their install id, and revoke their
 * live sessions. We only tear down when GitHub itself confirms the revocation:
 *  - `deleted`  -> `getInstallation` 404s (the installation is genuinely gone).
 *  - `suspend`  -> `getInstallation` returns it with `suspendedAt` set.
 * Any other outcome fails CLOSED: we do not remove.
 */
export async function confirmRevocationWithGitHub(installationId: number, action: "deleted" | "suspend"): Promise<boolean> {
  try {
    const info = await getInstallation(installationId);
    if (action === "suspend") return info.suspendedAt != null;
    console.warn(`[webhook] installation ${installationId} still active on GitHub; ignoring forged "deleted"`);
    return false;
  } catch (err) {
    // A 404 is GitHub confirming the installation is gone - the legitimate "deleted" case.
    if (err instanceof AppApiError && err.status === 404) return action === "deleted";
    console.warn(
      `[webhook] could not confirm ${action} of installation ${installationId}; failing closed`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
