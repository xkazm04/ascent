// POST /api/app/webhook - GitHub App events. The route is the door, not the handler: it reads a
// bounded body, verifies the HMAC, parses, claims the delivery against replay, and hands the delivery
// to the arm table in @/lib/github/webhook/arms.ts. Each arm declares its bind there, and every arm
// that writes tenant state runs only behind a BoundDelivery (@/lib/github/webhook/owner-bind.ts):
//   - installation / installation_repositories -> GitHub-confirmed lifecycle + watch reconcile.
//   - pull_request / check_run                  -> the PR maturity gate (Check Run + sticky comment).
//   - pull_request.closed / pull_request_review -> live AiChange evidence (stored-mapping bind only).
//   - push                                      -> the queued push rescan + the registry lane.
//   - branch_protection_rule / repository_ruleset / repository / member / team
//                                               -> a FREE control probe (+ the actor attribution).
//
// GitHub expects a fast 2xx, so the work runs in `after()` - scheduled to execute AFTER the response
// is sent, within the route's maxDuration. We always 200 (even on handler errors) so GitHub doesn't
// retry on our transient issues.

import { NextResponse, after } from "next/server";
import { verifyWebhook } from "@/lib/github/app";
import { claimWebhookDelivery } from "@/lib/db";
import { abandonDelivery, deliveryAlreadySeen, forgetLocalDelivery } from "@/lib/github/webhook-delivery";
import { dispatchWebhook } from "@/lib/github/webhook/arms";
import type { WebhookPayload } from "@/lib/github/webhook/payload";
import { readBoundedText } from "./body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// github-app-installation-webhooks #5: a GitHub HMAC never expires, so a captured, still-validly-signed
// delivery can be REPLAYED anytime within GitHub's redelivery horizon (hours/days). The in-memory cache
// is only a 10-min, process-local FAST PATH; the AUTHORITATIVE cross-instance replay defense is the DB claim
// (claimWebhookDelivery), whose default TTL also matched 10 min - far shorter than the window it defends, so
// a replay 10 min later re-claimed and fully reprocessed (double scan/alert/re-posted checks). Persist the
// claim for a full day so a replay across the redelivery horizon is rejected. A LEGITIMATE redelivery after a
// failure still retries: forgetDelivery() DELETES the claim on a deferred-work failure, so only
// SUCCESSFULLY-processed ids stay claimed - exactly the replay we want to keep rejecting.
const REPLAY_HORIZON_MS = 24 * 60 * 60_000;

export async function POST(request: Request) {
  // The push rescan's drain deadline is measured from here (fleetDeadlineAt), like /api/org/import.
  const invokedAt = Date.now();
  // Bounded read BEFORE the signature check: nothing has authenticated the sender yet, and GitHub never
  // sends more than its 25 MB cap, so an over-cap body is refused without being buffered or HMAC'd.
  const raw = await readBoundedText(request);
  if (raw === null) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  // Reject replays of an already-processed delivery (a verified signature alone can't distinguish a fresh
  // delivery from a re-sent capture). Two-level dedup: the in-memory Map is a fast first-level filter for
  // SAME-instance replays; the DB claim (claimWebhookDelivery) is the AUTHORITATIVE cross-instance check -
  // on a horizontally-scaled / serverless deploy each instance's Map starts empty, so process-local dedup
  // alone is near-useless against a replay routed to another instance (#3). The claim is released on a
  // deferred-processing failure (forgetDelivery) so a genuine redelivery still retries. Answer 200 so a
  // genuine GitHub redelivery of a duplicate isn't retried.
  // Parse BEFORE claiming (github-app-installation-webhooks 07-16 #4): the body is already in memory
  // and signature-verified, and a parse failure must not consume the delivery's claim - the 400 used to
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
      // the in-memory Map optimistically - roll that back, or this instance would short-circuit
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
    dispatchWebhook(event, {
      payload,
      deliveryId: delivery ?? undefined,
      invokedAt,
      maxDurationSec: maxDuration,
      defer: (task) => after(task),
    });
  } catch (err) {
    // Still 200 so GitHub doesn't endlessly retry on our transient DB issues - but release the
    // delivery from the seen-set so a GitHub/manual REDELIVERY isn't deduped: dedup must mean
    // "successfully processed", not merely "HTTP acknowledged".
    await abandonDelivery(delivery ?? undefined, () => console.error("[app/webhook] handler error", err));
  }

  return NextResponse.json({ ok: true, event });
}
