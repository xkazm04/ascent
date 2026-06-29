// Signed, expiring read-only share tokens for the live war-room (WAR-4) — so an owner can put their
// fleet wall on an unauthenticated TV/kiosk without exposing a session. The token IS the capability:
// an HMAC-signed `{org, exp}` payload. The shared page (/live/shared/[token]) verifies it and renders
// the wall READ-ONLY (no scan trigger — /api/org/scan stays session-gated), exposing only the same
// org rollup the dashboard shows. Inert (mint returns null / verify fails) without a signing secret.
// The HMAC framing is shared with lib/briefing-share.ts (EXEC-6) via lib/signed-share.ts.

import { resolveShareSecret, signShareToken, verifyShareToken } from "./signed-share";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Signing secret: a dedicated LIVE_SHARE_SECRET, else the existing AUTH_SECRET. Null = sharing off. */
function shareSecret(): string | null {
  return resolveShareSecret("LIVE_SHARE_SECRET");
}

export function liveShareEnabled(): boolean {
  return shareSecret() !== null;
}

/** Mint a `payload.sig` token for `org`, valid for `ttlMs`. Null when no signing secret is configured. */
export function signLiveShareToken(org: string, ttlMs: number = DEFAULT_TTL_MS): { token: string; expiresAt: number } | null {
  const secret = shareSecret();
  if (!secret) return null;
  const expiresAt = Date.now() + ttlMs;
  const token = signShareToken({ org: org.toLowerCase(), exp: expiresAt }, secret);
  return { token, expiresAt };
}

/** Verify a share token: signature must match (timing-safe) and it must not be expired. Org slug or null. */
export function verifyLiveShareToken(token: string): { org: string } | null {
  const parsed = verifyShareToken(token, shareSecret()) as { org?: unknown; exp?: unknown } | null;
  if (!parsed) return null;
  if (typeof parsed.org !== "string" || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
  return { org: parsed.org };
}
