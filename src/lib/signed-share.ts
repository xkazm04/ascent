// Shared HMAC codec for the signed, expiring read-only share tokens used by the executive briefing
// (lib/briefing-share.ts, EXEC-6) and the live war-room (lib/live-share.ts, WAR-4). Both mint the
// SAME `<base64url(JSON payload)>.<sig>` framing and verify it timing-safe; only the env var that
// names the dedicated secret, the payload shape, and the TTL differ. Those differences live in the
// two callers — this module is the single source of the crypto so the framing can never drift apart.
//
// Token format is intentionally byte-stable: callers build the payload object themselves (preserving
// key order) so JSON.stringify is deterministic and already-issued tokens keep verifying.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Resolve a signing secret from a dedicated env var, falling back to AUTH_SECRET. Null = sharing off. */
export function resolveShareSecret(primaryEnvVar: string): string | null {
  return (process.env[primaryEnvVar] || process.env.AUTH_SECRET || "").trim() || null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a `payload.sig` token. The caller passes the payload object (key order is significant). */
export function signShareToken(payload: Record<string, unknown>, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Verify a `payload.sig` token: signature must match (timing-safe) and the framing must be well-formed.
 * Returns the decoded payload as `unknown` (the caller validates its shape + expiry), or null on any
 * failure — bad secret, missing/unsigned token, length-mismatched sig, forged sig, or non-JSON payload.
 */
export function verifyShareToken(token: string, secret: string | null): unknown {
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}
