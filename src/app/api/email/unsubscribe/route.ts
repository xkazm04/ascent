// GET  /api/email/unsubscribe?token=...  -> a tiny confirm page (NO mutation)
// POST /api/email/unsubscribe            -> clears the org's alert sink (form-encoded or JSON token)
//
// The stop switch for org alert mail (see src/lib/email/alert-sink.ts). The token is the capability —
// an HMAC over the org slug, minted only into mail we actually sent — so this route is deliberately
// NOT same-origin-gated and NOT session-gated: a recipient must be able to act on it from their inbox,
// signed in to nothing.
//
// GET DOES NOT MUTATE. Mail clients, link scanners, and corporate security gateways prefetch GET links
// routinely — the same reason peekInvite was split out of acceptInvite. A prefetch that silently muted
// a tenant's alerting would be indistinguishable from the user clicking. So GET renders a one-button
// confirm form and POST performs the clear.
//
// Clearing the sink is the honest unsubscribe: it stops the mail AND the webhook pushes, because they
// are one setting. The confirm page says so rather than pretending the two can be separated.

import { NextResponse } from "next/server";
import { isDbConfigured, setOrgAlertWebhook } from "@/lib/db";
import { escapeHtml } from "@/lib/email/render";
import { unsubscribeConfigured, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#0f172a;font-family:ui-sans-serif,system-ui,sans-serif;color:#e2e8f0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8">Ascent</p>
<h1 style="margin:0 0 12px;font-size:20px;color:#fff">${escapeHtml(title)}</h1>
${body}
</div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function p(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;color:#cbd5e1;line-height:1.5">${escapeHtml(text)}</p>`;
}

export async function GET(request: Request) {
  if (!unsubscribeConfigured()) {
    return page("Unsubscribe isn't configured", p("This deployment has no unsubscribe secret set. Clear the alert sink in your Ascent organization settings to stop these emails."), 503);
  }
  const token = new URL(request.url).searchParams.get("token");
  const org = verifyUnsubscribeToken(token);
  if (!org) return page("That link isn't valid", p("This unsubscribe link is invalid or has expired. Clear the alert sink in your Ascent organization settings to stop these emails."), 400);
  return page(
    `Stop Ascent alerts for ${org}?`,
    `${p(`This clears the alert sink for the "${org}" organization. Ascent will stop emailing this address. Because the sink is one setting, it also stops any webhook pushes for this organization. An owner can set it again at any time.`)}
<form method="post" action="/api/email/unsubscribe">
  <input type="hidden" name="token" value="${escapeHtml(token ?? "")}">
  <button type="submit" style="background:#22d3ee;color:#06283d;font-weight:600;border:0;padding:11px 18px;border-radius:10px;font-size:15px;cursor:pointer">Stop these emails</button>
</form>`,
  );
}

export async function POST(request: Request) {
  if (!unsubscribeConfigured()) {
    return page("Unsubscribe isn't configured", p("This deployment has no unsubscribe secret set."), 503);
  }
  // Accept both a posted form (the confirm page above) and JSON (a mail client's one-click POST).
  let token: string | null = null;
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    token = body.token ?? null;
  } else {
    const form = await request.formData().catch(() => null);
    token = (form?.get("token") as string | null) ?? null;
  }
  token ??= new URL(request.url).searchParams.get("token");
  const org = verifyUnsubscribeToken(token);
  if (!org) return page("That link isn't valid", p("This unsubscribe link is invalid or has expired."), 400);
  if (!isDbConfigured()) return page("Nothing to change", p("This deployment has no database, so no alert sink is stored."), 503);
  const cleared = await setOrgAlertWebhook(org, null).catch(() => undefined);
  if (cleared === undefined) return page("Organization not found", p(`No organization named "${org}" exists on this deployment.`), 404);
  return page(`Unsubscribed from ${org}`, p("The alert sink has been cleared. Ascent will not email this address about this organization again."));
}
