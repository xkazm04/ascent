// Alert sink configuration, validation and delivery. Message builders stay in alerts.ts.
import { isPrivateOrInternalHost } from "@/lib/net/ssrf";
import type { AlertMessage } from "./alerts";


/** Minimal email shape for a `mailto:` sink — one @, no whitespace, a dotted domain. Same rule as
 *  isValidEmail in @/lib/email (restated here to keep this module free of a server-only import). */
const SINK_EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


/**
 * The address a sink points at when it is an EMAIL sink (`mailto:you@example.com`), else null. Pure.
 * G7-01: the alert sink accepts an address alongside an https webhook so an org whose leadership
 * doesn't live in Slack can still receive regression alerts, the weekly digest and the credit/goal/
 * spend pushes. Kept here (not only in the email module) so `dispatchAlert` can branch without a
 * server-only import, and so the shape is pinned by this module's unit tests.
 */
export function emailSinkAddress(sink: string | null | undefined): string | null {
  const raw = sink?.trim();
  if (!raw || !/^mailto:/i.test(raw)) return null;
  const addr = (raw.slice("mailto:".length).split("?")[0] ?? "").trim();
  return SINK_EMAIL_SHAPE.test(addr) && addr.length <= 254 ? addr : null;
}


/**
 * Resolve the sink an alert should POST to: the org's own webhook when set (multi-tenant routing —
 * each tenant gets its own fleet intelligence), else the global ALERT_WEBHOOK_URL (single-tenant /
 * operator deployments), else null (no-op). Pure given its argument — the env read is the only
 * ambient input, matching the layer's existing convention.
 */
export function resolveAlertWebhook(orgWebhookUrl?: string | null): string | null {
  const org = orgWebhookUrl?.trim();
  if (org) return org;
  const global = process.env.ALERT_WEBHOOK_URL?.trim();
  return global || null;
}


/**
 * What KIND of sink an alert actually left by — for the AlertEvent history row, not for routing.
 *
 * Takes the ORG's sink field and RESOLVES it first (org → the global ALERT_WEBHOOK_URL → none), because
 * the row must describe the channel the message travelled on, not the column the caller happened to
 * read. Classifying the unresolved field gets two things wrong on a tenant riding the global fallback:
 * it reports `webhook` for a global `mailto:` sink (the mail went out; the record says otherwise), and
 * it reports `webhook` where the org had no sink at all instead of the honest `null`.
 *
 * `src/lib/scan-alerts.ts` and `src/lib/standard/conformance-alerts.ts` already classified a RESOLVED
 * url; this is the same rule, exported so a caller holding only the org's field cannot restate it
 * against the wrong input.
 */
export function sinkKindForOrg(orgWebhookUrl: string | null | undefined): "webhook" | "email" | null {
  const resolved = resolveAlertWebhook(orgWebhookUrl);
  if (!resolved) return null;
  return emailSinkAddress(resolved) ? "email" : "webhook";
}


/** Whether an alert sink is configured (so callers can skip the work entirely when it isn't).
 *  Pass the org's webhook (when known) so a tenant with its own sink counts even with no global. */
export function isAlertConfigured(orgWebhookUrl?: string | null): boolean {
  return resolveAlertWebhook(orgWebhookUrl) !== null;
}


/**
 * Validate a caller-supplied org webhook URL before storing it. Pure (unit-tested). The server
 * POSTs org data to this URL, so it must parse, be https, carry no inline credentials, and not
 * target a private/internal host — the established "validate outbound URLs built from caller input"
 * rule. The private/internal host check is the SHARED isPrivateOrInternalHost guard (same one the
 * branding logo-URL guard uses), so this now also rejects CGNAT 100.64/10, IPv6 unique-local
 * (fc00::/7) and link-local (fe80::), multicast/reserved, and internal hostnames (*.local/*.internal/
 * cloud metadata) the old hand-rolled list missed. DNS-rebinding is out of scope here.
 */
export function validateAlertWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length > 1000) return { ok: false, error: "Webhook URL is too long (max 1000 chars)." };
  // G7-01: an EMAIL sink (`mailto:you@example.com`) is a first-class sink value. Storing it is the
  // org's explicit opt-in to alert mail — an admin-authenticated act, on the same field and with the
  // same blast radius as pointing the sink at a Slack channel. Validated on shape only (no SSRF
  // surface: nothing is fetched), and normalized to a lowercase scheme so the dispatcher's check and
  // the stored value can't drift.
  if (/^mailto:/i.test(trimmed)) {
    const addr = emailSinkAddress(trimmed);
    if (!addr) return { ok: false, error: "mailto: sink must be a single valid email address." };
    return { ok: true, url: `mailto:${addr}` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Not a valid URL." };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "Webhook must be an https:// URL." };
  if (parsed.username || parsed.password) return { ok: false, error: "Credentials in the URL are not allowed." };
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  if (isPrivateOrInternalHost(host)) return { ok: false, error: "Webhook host must be publicly reachable." };
  return { ok: true, url: parsed.toString() };
}


/** Per-POST deadline for an alert dispatch. A hung sink (a black-holed webhook, a Slack incident, a
 *  sink behind a firewall that never RSTs) must not block the caller indefinitely — this is critical
 *  for the weekly-digest loop, which dispatches to many orgs' sinks in one run and would otherwise let
 *  one slow tenant starve the rest until the socket dies. */
const DISPATCH_TIMEOUT_MS = 8000;


/**
 * POST an alert to its sink (Slack incoming-webhook compatible): `opts.webhookUrl` (the org's own
 * sink) when set, falling back to the global ALERT_WEBHOOK_URL. Returns true on a 2xx, false on any
 * failure or when no sink is configured — never throws, so a flaky webhook can't fail the scan that
 * produced the alert. The POST is bounded by DISPATCH_TIMEOUT_MS so a hung sink aborts (→ false)
 * rather than blocking; `signal` lets a caller abort with the surrounding work, composed with the
 * timeout so whichever fires first wins.
 */
export async function dispatchAlert(
  message: AlertMessage,
  opts: { signal?: AbortSignal; webhookUrl?: string | null; org?: string | null } = {},
): Promise<boolean> {
  if (opts.signal?.aborted) return false;
  const url = resolveAlertWebhook(opts.webhookUrl);
  if (!url) return false;
  // EMAIL SINK (G7-01). Branch before the POST, and reach the mail transport through a DYNAMIC import:
  // src/lib/email pulls in the provider factory (and, lazily, the AWS SDK), and this module is reachable
  // from a client bundle via @/lib/alerts' pure exports (DEFAULT_THRESHOLDS in /trends). A static import
  // would drag server-only code across that boundary — the failure mode that passes tsc and unit tests
  // and only breaks `next build`. Returns FALSE when nothing was actually sent (no provider configured),
  // which is what lets the digest release its once-per-window claim and retry.
  if (/^mailto:/i.test(url.trim())) {
    const to = emailSinkAddress(url);
    // A malformed mailto: sink must DEAD-END here. Falling through would hand `fetch` a mailto: URL
    // (a throw at best, an unpredictable request at worst) for a value the org clearly meant as mail.
    if (!to) {
      console.error("[alerts] sink is a malformed mailto: — nothing dispatched");
      return false;
    }
    try {
      const { dispatchAlertEmail } = await import("./email/alert-sink");
      if (opts.signal?.aborted) return false;
      return await dispatchAlertEmail(to, message, { org: opts.org ?? null });
    } catch (err) {
      console.error("[alerts] email dispatch error", err instanceof Error ? err.message : err);
      return false;
    }
  }
  const timeout = AbortSignal.timeout(DISPATCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message.text, blocks: message.blocks }),
      signal,
    });
    if (!res.ok) {
      console.error("[alerts] dispatch failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[alerts] dispatch error", err instanceof Error ? err.message : err);
    return false;
  }
}
