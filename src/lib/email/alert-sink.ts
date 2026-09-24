// G7-01 — the email half of the alert sink. Regression alerts, the low-credit push, the weekly digest
// and the goal/spend alerts were all Slack-webhook-only: an org whose leadership doesn't live in Slack
// heard from Ascent never. This module renders an already-built AlertMessage as mail and sends it
// through the SINGLE existing transport (src/lib/email → dispatchBuiltEmail → the env-selected sender).
// No second transport, no second env story.
//
// HOW AN ADDRESS EVER GETS HERE (the opt-in, and why it needed no migration): the org's existing alert
// sink field (Organization.alertWebhookUrl) accepts a `mailto:someone@example.com` value alongside an
// https webhook. An admin typing that address into the org's Alerts settings IS the opt-in — the same
// deliberate, admin-authenticated act that already routes the org's fleet intelligence to a Slack
// channel. Nothing is sent to an address nobody configured: with no sink and no global ALERT_WEBHOOK_URL
// the dispatcher is a no-op, exactly as before, and with no email provider configured this path sends
// nothing either (the no-op sender reports `skipped` and dispatchAlert returns false).
//
// HOW IT STOPS: every alert mail carries a one-click unsubscribe (RFC 8058 List-Unsubscribe headers are
// not available through the SES SendEmail shape used here, so the link is in the body and in the
// footer) pointing at /api/email/unsubscribe with an HMAC-signed token that clears that org's sink.
// When no signing secret is configured the footer instead names the settings page — an honest
// "here is where to turn this off" rather than a dead link.

import type { AlertMessage } from "@/lib/alerts";
import { publicBaseUrl } from "@/lib/site";
import { dispatchBuiltEmail } from "./index";
import { emailShell, paragraph, preBlock } from "./render";
import { unsubscribeUrl } from "./unsubscribe";

/** The builder's mail subject when it set one, else the first non-empty line of the plain text. Pure. */
function subjectFor(message: AlertMessage): string {
  const first =
    message.mail?.subject?.trim() || (message.text.split("\n").find((l) => l.trim().length > 0) ?? "Ascent alert");
  return first.length > 180 ? `${first.slice(0, 177)}…` : first;
}

/** The card body: the builder's own mail HTML when it has one, else the plain text verbatim. Pure. */
function bodyFor(message: AlertMessage): string {
  if (message.mail?.bodyHtml) return message.mail.bodyHtml;
  // With a subject of its own, the first line is body, not heading, so none of the text is dropped
  // (an admin resend: the prefix line, then the whole stored alert).
  if (message.mail?.subject?.trim()) return preBlock(message.text);
  return preBlock(message.text.split("\n").slice(1).join("\n").trim() || message.text);
}

/**
 * Render an AlertMessage as mail. PURE — the Block Kit `blocks` are Slack's shape and are deliberately
 * IGNORED; the `text` fallback every builder already produces is the portable body, so a new alert
 * builder gets an email rendering for free with no per-builder template. A builder with a better mail
 * rendering (the weekly digest) attaches `message.mail` and gets it here instead. Pure so the exact
 * bytes are unit-testable.
 */
export function buildAlertEmail(input: {
  message: AlertMessage;
  /** Org slug — named in the footer so a recipient can tell which tenant's sink this is. */
  org?: string | null;
  /** Absolute unsubscribe link, or null when no signing secret / public base URL is configured. */
  unsubscribe?: string | null;
  /** Where to point a reader when there's no one-click link. */
  settingsUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const { message, org, unsubscribe, settingsUrl } = input;
  const subject = subjectFor(message);
  const why = org
    ? `You're receiving this because the alert sink for the "${org}" organization on Ascent is set to this address.`
    : `You're receiving this because this address is configured as an Ascent alert sink.`;
  const stop = unsubscribe
    ? `To stop these emails, open: ${unsubscribe}`
    : settingsUrl
      ? `To stop these emails, clear the alert sink in Ascent (${settingsUrl}).`
      : `To stop these emails, clear the alert sink in your Ascent organization settings.`;

  const text = [message.text, "", "---", why, stop].join("\n");
  const html = emailShell({
    heading: subject,
    // The alert body is rendered verbatim (escaped, pre-wrapped) rather than re-templated per builder,
    // unless the builder brought its own mail body: the builders own the wording, this module only
    // owns the envelope.
    bodyHtml: [bodyFor(message), paragraph(why)].join(""),
    cta: unsubscribe ? { href: unsubscribe, label: "Stop these emails" } : null,
    footer: `${why} ${stop}`,
  });
  return { subject, html, text };
}

/**
 * Send an alert to an email sink. Best-effort: returns true only when a message was actually accepted
 * for delivery, so a deploy with no email provider reports FALSE (nothing was sent) rather than a
 * misleading success — the digest cron relies on that to release its once-per-window claim and retry.
 * Never throws.
 */
export async function dispatchAlertEmail(
  to: string,
  message: AlertMessage,
  opts: { org?: string | null } = {},
): Promise<boolean> {
  const base = publicBaseUrl();
  const built = buildAlertEmail({
    message,
    org: opts.org ?? null,
    unsubscribe: opts.org ? unsubscribeUrl(opts.org) : null,
    settingsUrl: base && opts.org ? `${base}/org/${encodeURIComponent(opts.org)}` : null,
  });
  const res = await dispatchBuiltEmail(to, built);
  return res.ok && !res.skipped;
}
