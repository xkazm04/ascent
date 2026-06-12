// GET  /api/org/alerts?org=slug          -> { webhookUrl }            (admin)
// POST /api/org/alerts { org, webhookUrl } -> { ok, webhookUrl }      (admin)
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
import { validateAlertWebhookUrl } from "@/lib/alerts";

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
  const body = (await request.json().catch(() => ({}))) as { org?: string; webhookUrl?: unknown };
  if (!body.org) return NextResponse.json({ error: "Provide { org, webhookUrl }." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "admin");
  if (denied) return denied;

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
