// GET  /api/org/alerts?org=slug                                  -> { webhookUrl, overallDrop, dimensionDrop }  (admin)
// GET  /api/org/alerts?org=slug&movement=1                       -> { movement }          (member) what moved since you last looked
// GET  /api/org/alerts?org=slug&history=1                        -> { events }            (member) recent alert dispatches (AlertEvent)
// POST /api/org/alerts { org, webhookUrl?, overallDrop?, dimensionDrop? } -> { ok, ... }  (admin)  set/clear sink + thresholds
// POST /api/org/alerts { org, test: true }                       -> { ok, delivered }     (admin)  send a test alert
// POST /api/org/alerts { org, seen: true }                       -> { ok, seen }          (member) advance the viewer's watermark
//
// Per-org alert sink configuration — where regression alerts, low-credit pushes and the weekly
// digest for this org are POSTed (Slack-compatible incoming webhook). Setting it routes the org's
// fleet intelligence to its OWN channel instead of the operator's global ALERT_WEBHOOK_URL; clearing
// it (webhookUrl: null or "") falls back to the global sink (or a clean no-op when that's unset).
// Admin-gated in BOTH directions: an incoming-webhook URL is a channel-posting secret, so reads are
// as sensitive as writes.

import { NextResponse } from "next/server";
import {
  getAlertsWatermark,
  getOrgAlertThresholds,
  getOrgAlertWebhook,
  getOrgMovementSince,
  isDbConfigured,
  listAlertEvents,
  markAlertsSeen,
  recordOrgAudit,
  setOrgAlertThresholds,
  setOrgAlertWebhook,
} from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { buildTestAlertMessage, dispatchAlert, validateAlertWebhookUrl } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parse a threshold field: a positive integer (1..100), or null when blank/null. `false` = invalid. */
function parseThreshold(v: unknown): number | null | false {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100) return false;
  return n;
}

/**
 * "What moved since you last looked" — the Alerts chip's movement count, read from records the scan
 * pipeline ALREADY persists (Shared Org Memory), measured from this viewer's own Membership
 * watermark. Split from the config read on purpose: the config payload carries a channel-posting
 * secret (admin-only, loaded lazily on open), while the count renders on page load for any member.
 *
 * Every degraded path answers `{ movement: null }`, which the chip renders exactly as it did before
 * this feature existed: auth-off deployments and the public org (no viewer identity), a viewer with
 * no membership row (no per-user watermark to measure from), and any read failure.
 */
async function movementResponse(org: string): Promise<NextResponse> {
  const denied = await requireOrgRole(org, "viewer");
  if (denied) return denied;
  try {
    const login = await resolveViewerLogin();
    if (!login) return NextResponse.json({ movement: null });
    const watermark = await getAlertsWatermark(org, login);
    if (!watermark) return NextResponse.json({ movement: null });
    const movement = await getOrgMovementSince(org, watermark.since);
    if (!movement) return NextResponse.json({ movement: null });
    return NextResponse.json({
      movement: {
        since: movement.since.toISOString(),
        firstLook: !watermark.hadWatermark,
        count: movement.count,
        capped: movement.capped,
        items: movement.items.map((i) => ({
          repo: i.repo,
          event: i.event,
          summary: i.summary,
          at: i.at.toISOString(),
        })),
      },
    });
  } catch (err) {
    // A chip decoration must never turn an org page into an error: fall back to the countless chip.
    console.error("[api/org/alerts] movement read failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ movement: null });
  }
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const org = params.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  // Movement is a separate, member-readable payload — resolved BEFORE the admin gate below.
  if (params.get("movement") === "1") return movementResponse(org);
  // Alert history — member-readable like movement (rows carry titles and outcomes, never the sink
  // URL), resolved BEFORE the admin gate. Degrades to { events: [] } on any read failure: a drawer
  // section must never error the popover.
  if (params.get("history") === "1") {
    const deniedHistory = await requireOrgRole(org, "viewer");
    if (deniedHistory) return deniedHistory;
    const events = await listAlertEvents(org).catch(() => null);
    return NextResponse.json({ events: events ?? [] });
  }
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;
  const [webhookUrl, thresholds] = await Promise.all([getOrgAlertWebhook(org), getOrgAlertThresholds(org)]);
  return NextResponse.json({ webhookUrl, overallDrop: thresholds.overallDrop, dimensionDrop: thresholds.dimensionDrop });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  // CSRF defense-in-depth, matching the credit-grant mutation (the session cookie is SameSite=Lax).
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    webhookUrl?: unknown;
    overallDrop?: unknown;
    dimensionDrop?: unknown;
    test?: boolean;
    seen?: boolean;
  };
  if (!body.org) return NextResponse.json({ error: "Provide { org, webhookUrl }." }, { status: 400 });

  // Watermark advance ("I've now looked at what moved"). Member-gated, not admin-gated — reading your
  // own fleet's movement is not a privileged action, and the stamp lands on the CALLER's own
  // Membership row, so it can't touch anyone else's read state. Handled before the admin gate below.
  if (body.seen === true) {
    const deniedSeen = await requireOrgRole(body.org, "viewer");
    if (deniedSeen) return deniedSeen;
    const login = await resolveViewerLogin();
    // No viewer identity (auth-off / public org) → nothing to stamp; a clean no-op, not an error.
    if (!login) return NextResponse.json({ ok: true, seen: false });
    const at = new Date();
    const stamped = await markAlertsSeen(body.org, login, at).catch(() => false);
    return NextResponse.json({ ok: true, seen: stamped, ...(stamped ? { seenAt: at.toISOString() } : {}) });
  }

  const denied = await requireOrgRole(body.org, "admin");
  if (denied) return denied;

  // Test-send: the popover's whole job is to validate the CANDIDATE webhook the admin is still
  // editing, so when the request carries a non-empty `webhookUrl` we validate it and dispatch to
  // THAT url — not the previously-stored sink (which would falsely report a typo'd new URL as
  // "delivered ✓" via a stored/global fallback). A blank field still tests the org's resolved sink.
  if (body.test === true) {
    let testUrl: string | null;
    let candidate = false;
    if (typeof body.webhookUrl === "string" && body.webhookUrl.trim() !== "") {
      const v = validateAlertWebhookUrl(body.webhookUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      testUrl = v.url;
      candidate = true;
    } else {
      testUrl = await getOrgAlertWebhook(body.org);
    }
    const delivered = await dispatchAlert(buildTestAlertMessage(body.org), { webhookUrl: testUrl });
    return NextResponse.json({
      ok: true,
      delivered,
      ...(delivered
        ? {}
        : {
            error: candidate
              ? "Couldn't deliver to that webhook URL. Check it's a live incoming webhook."
              : "No alert sink is configured (set a webhook, or the global ALERT_WEBHOOK_URL).",
          }),
    });
  }

  const hasWebhook = "webhookUrl" in body;
  const hasThresholds = "overallDrop" in body || "dimensionDrop" in body;
  if (!hasWebhook && !hasThresholds) {
    return NextResponse.json({ error: "Provide webhookUrl and/or overallDrop/dimensionDrop." }, { status: 400 });
  }

  // resolveViewerLogin, not getSession: the dormant custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this audit row recorded a null actor in production.
  const actorLogin = await resolveViewerLogin();
  const result: { ok: true; webhookUrl?: string | null; overallDrop?: number | null; dimensionDrop?: number | null } = { ok: true };

  // Webhook: null / "" clears the override (fall back to the global sink); anything else must validate.
  if (hasWebhook) {
    let url: string | null = null;
    if (typeof body.webhookUrl === "string" && body.webhookUrl.trim() !== "") {
      const v = validateAlertWebhookUrl(body.webhookUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      url = v.url;
    } else if (body.webhookUrl != null && typeof body.webhookUrl !== "string") {
      return NextResponse.json({ error: "webhookUrl must be a string or null." }, { status: 400 });
    }
    const stored = await setOrgAlertWebhook(body.org, url);
    if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
    result.webhookUrl = stored;
    // SEC #1: actor goes in the dedicated `actorId` column so the viewer/filter can surface it.
    await recordOrgAudit(
      "org.alerts.webhook",
      body.org,
      { org: body.org, action: url ? "set" : "cleared" },
      actorLogin ?? undefined,
    ).catch(() => {});
  }

  // Regression thresholds: null clears a field back to DEFAULT_THRESHOLDS; a positive int 1..100 sets it.
  if (hasThresholds) {
    const overallDrop = parseThreshold(body.overallDrop);
    const dimensionDrop = parseThreshold(body.dimensionDrop);
    if (overallDrop === false || dimensionDrop === false) {
      return NextResponse.json({ error: "overallDrop/dimensionDrop must be an integer 1..100 or null." }, { status: 400 });
    }
    const stored = await setOrgAlertThresholds(body.org, { overallDrop, dimensionDrop });
    if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
    result.overallDrop = stored.overallDrop;
    result.dimensionDrop = stored.dimensionDrop;
    // SEC #1: actor goes in the dedicated `actorId` column so the viewer/filter can surface it.
    await recordOrgAudit(
      "org.alerts.thresholds",
      body.org,
      { org: body.org, overallDrop, dimensionDrop },
      actorLogin ?? undefined,
    ).catch(() => {});
  }

  return NextResponse.json(result);
}
