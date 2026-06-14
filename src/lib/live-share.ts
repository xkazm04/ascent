// Signed, expiring read-only share tokens for the live war-room (WAR-4) — so an owner can put their
// fleet wall on an unauthenticated TV/kiosk without exposing a session. The token IS the capability:
// an HMAC-signed `{org, exp}` payload. The shared page (/live/shared/[token]) verifies it and renders
// the wall READ-ONLY (no scan trigger — /api/org/scan stays session-gated), exposing only the same
// org rollup the dashboard shows. Inert (mint returns null / verify fails) without a signing secret.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Signing secret: a dedicated LIVE_SHARE_SECRET, else the existing AUTH_SECRET. Null = sharing off. */
function shareSecret(): string | null {
  return (process.env.LIVE_SHARE_SECRET || process.env.AUTH_SECRET || "").trim() || null;
}

export function liveShareEnabled(): boolean {
  return shareSecret() !== null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a `payload.sig` token for `org`, valid for `ttlMs`. Null when no signing secret is configured. */
export function signLiveShareToken(org: string, ttlMs: number = DEFAULT_TTL_MS): { token: string; expiresAt: number } | null {
  const secret = shareSecret();
  if (!secret) return null;
  const expiresAt = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ org: org.toLowerCase(), exp: expiresAt })).toString("base64url");
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

/** Verify a share token: signature must match (timing-safe) and it must not be expired. Org slug or null. */
export function verifyLiveShareToken(token: string): { org: string } | null {
  const secret = shareSecret();
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { org?: unknown; exp?: unknown };
    if (typeof parsed.org !== "string" || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { org: parsed.org };
  } catch {
    return null;
  }
}
