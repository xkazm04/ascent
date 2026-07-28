// One-click unsubscribe for org alert mail. An address that receives recurring mail must be able to
// stop it without an account, a login, or a support request — so the link carries its own capability:
// an HMAC-signed `<org>.<sig>` token, verified with a constant-time compare.
//
// WHY A SECRET AND NOT JUST `?org=slug`: acting on the link CLEARS the org's alert sink, which also
// silences that org's Slack/regression pushes. An unauthenticated, guessable URL would let anyone mute
// any tenant's alerting by slug. The token binds the action to a link we actually mailed.
//
// EMAIL_UNSUBSCRIBE_SECRET is the signing key; it deliberately does NOT fall back to CRON_SECRET or any
// other credential (one secret, one blast radius). With it unset there is no one-click link at all —
// mint returns null, the mail footer degrades to naming the settings page, and the route answers 503.
// That is the correct default for an operator who hasn't thought about it yet: no dead link, no
// unauthenticated mutation endpoint.

import { createHmac, timingSafeEqual } from "node:crypto";
import { publicBaseUrl } from "@/lib/site";

/** The configured signing secret, or null. */
function secret(): string | null {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim();
  return s ? s : null;
}

/** Whether one-click unsubscribe is available on this deploy. */
export function unsubscribeConfigured(): boolean {
  return secret() !== null;
}

/** HMAC-SHA256 of `org` under `key`, base64url. Pure given its args. */
export function signOrg(org: string, key: string): string {
  return createHmac("sha256", key).update(`unsubscribe:${org.toLowerCase()}`).digest("base64url");
}

/** Mint an unsubscribe token for an org, or null when unconfigured. */
export function mintUnsubscribeToken(org: string): string | null {
  const key = secret();
  if (!key) return null;
  return `${org.toLowerCase()}.${signOrg(org, key)}`;
}

/**
 * Verify a token and return the org slug it authorizes, or null. Constant-time signature compare; a
 * length mismatch short-circuits without calling timingSafeEqual (which throws on unequal lengths).
 */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const key = secret();
  if (!key || !token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const org = token.slice(0, idx);
  const presented = Buffer.from(token.slice(idx + 1));
  const expected = Buffer.from(signOrg(org, key));
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  return org.toLowerCase();
}

/** Absolute one-click unsubscribe URL for an org, or null (no secret, or no public base URL). */
export function unsubscribeUrl(org: string): string | null {
  const token = mintUnsubscribeToken(org);
  const base = publicBaseUrl();
  if (!token || !base) return null;
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
