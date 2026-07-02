// GET  /api/org/alerts?org=slug                                  -> { webhookUrl, overallDrop, dimensionDrop }  (admin)
// POST /api/org/alerts { org, webhookUrl?, overallDrop?, dimensionDrop? } -> { ok, ... }  (admin)  set/clear sink + thresholds
// POST /api/org/alerts { org, test: true }                       -> { ok, delivered }     (admin)  send a test alert
//
// Per-org alert sink configuration — where regression alerts, low-credit pushes and the weekly
// digest for this org are POSTed (Slack-compatible incoming webhook). Setting it routes the org's
// fleet intelligence to its OWN channel instead of the operator's global ALERT_WEBHOOK_URL; clearing
// it (webhookUrl: null or "") falls back to the global sink (or a clean no-op when that's unset).
// Admin-gated in BOTH directions: an incoming-webhook URL is a channel-posting secret, so reads are
// as sensitive as writes.

import { NextResponse } from "next/server";
import {
  getOrgAlertThresholds,
  getOrgAlertWebhook,
  getOrgId,
  isDbConfigured,
  recordAudit,
  setOrgAlertThresholds,
  setOrgAlertWebhook,
} from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { getSession, isSameOrigin } from "@/lib/auth";
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

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;
  const [webhookUrl, thresholds] = await Promise.all([getOrgAlertWebhook(org), getOrgAlertThresholds(org)]);
  return NextResponse.json({ webhookUrl, overallDrop: thresholds.overallDrop, dimensionDrop: thresholds.dimensionDrop });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  // CSRF defense-in-depth, matching the credit-grant mutation (the session cookie is SameSite=Lax).
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    webhookUrl?: unknown;
    overallDrop?: unknown;
    dimensionDrop?: unknown;
    test?: boolean;
  };
  if (!body.org) return NextResponse.json({ error: "Provide { org, webhookUrl }." }, { status: 400 });
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
              ? "Couldn't deliver to that webhook URL — check it's a live incoming webhook."
              : "No alert sink is configured (set a webhook, or the global ALERT_WEBHOOK_URL).",
          }),
    });
  }

  const hasWebhook = "webhookUrl" in body;
  const hasThresholds = "overallDrop" in body || "dimensionDrop" in body;
  if (!hasWebhook && !hasThresholds) {
    return NextResponse.json({ error: "Provide webhookUrl and/or overallDrop/dimensionDrop." }, { status: 400 });
  }

  const session = await getSession();
  const orgId = (await getOrgId(body.org).catch(() => null)) ?? undefined;
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
    await recordAudit(
      "org.alerts.webhook",
      { org: body.org, action: url ? "set" : "cleared" },
      { orgId, actorId: session?.login },
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
    await recordAudit(
      "org.alerts.thresholds",
      { org: body.org, overallDrop, dimensionDrop },
      { orgId, actorId: session?.login },
    ).catch(() => {});
  }

  return NextResponse.json(result);
}
