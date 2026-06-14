// GET  /api/org/alerts?org=slug              -> { webhookUrl }            (admin)
// POST /api/org/alerts { org, webhookUrl }     -> { ok, webhookUrl }      (admin)  set/clear the sink
// POST /api/org/alerts { org, test: true }     -> { ok, delivered }      (admin)  send a test alert
//
// Per-org alert sink configuration — where regression alerts, low-credit pushes and the weekly
// digest for this org are POSTed (Slack-compatible incoming webhook). Setting it routes the org's
// fleet intelligence to its OWN channel instead of the operator's global ALERT_WEBHOOK_URL; clearing
// it (webhookUrl: null or "") falls back to the global sink (or a clean no-op when that's unset).
// Admin-gated in BOTH directions: an incoming-webhook URL is a channel-posting secret, so reads are
// as sensitive as writes.

import { NextResponse } from "next/server";
import { getOrgAlertWebhook, getOrgId, isDbConfigured, recordAudit, setOrgAlertWebhook } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { getSession, isSameOrigin } from "@/lib/auth";
import { dispatchAlert, validateAlertWebhookUrl, type AlertMessage } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;
  return NextResponse.json({ webhookUrl: await getOrgAlertWebhook(org) });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  // CSRF defense-in-depth, matching the credit-grant mutation (the session cookie is SameSite=Lax).
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; webhookUrl?: unknown; test?: boolean };
  if (!body.org) return NextResponse.json({ error: "Provide { org, webhookUrl }." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "admin");
  if (denied) return denied;

  // Test-send: build a sample alert and POST it to the org's resolved sink so an admin can confirm
  // delivery now instead of waiting for a real regression days later.
  if (body.test === true) {
    const orgUrl = await getOrgAlertWebhook(body.org);
    const sample: AlertMessage = {
      text: `✅ Ascent test alert for ${body.org}\nIf you can read this in your channel, alert routing works. Regression, low-credit and weekly-digest alerts will arrive here.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*✅ Ascent test alert for ${body.org}*\nIf you can read this in your channel, alert routing works. Regression, low-credit and weekly-digest alerts will arrive here.`,
          },
        },
      ],
    };
    const delivered = await dispatchAlert(sample, { webhookUrl: orgUrl });
    return NextResponse.json({
      ok: true,
      delivered,
      ...(delivered ? {} : { error: "No alert sink is configured (set a webhook, or the global ALERT_WEBHOOK_URL)." }),
    });
  }

  // null / "" clears the override (fall back to the global sink); anything else must validate.
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
  // Audit the change (not the secret itself — just that/by whom it was set or cleared).
  const session = await getSession();
  const orgId = (await getOrgId(body.org).catch(() => null)) ?? undefined;
  await recordAudit(
    "org.alerts.webhook",
    { org: body.org, action: url ? "set" : "cleared", actor: session?.login ?? "system" },
    { orgId },
  ).catch(() => {});
  return NextResponse.json({ ok: true, webhookUrl: stored });
}
