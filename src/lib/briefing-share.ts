// Signed, expiring read-only share tokens for the executive briefing (EXEC-6) — so an owner can send
// a board member a briefing without giving them an account. The token IS the capability: an
// HMAC-signed `{org, range, from, to, exp}` payload (the window travels so the recipient sees the same
// period). The shared page (/share/briefing/[token]) verifies it and re-runs buildExecBriefing
// READ-ONLY, exposing only what the briefing tab shows. Inert without a signing secret. Mirrors
// lib/live-share.ts (WAR-4).

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — a board cycle

/** Signing secret: a dedicated BRIEFING_SHARE_SECRET, else the existing AUTH_SECRET. Null = off. */
function shareSecret(): string | null {
  return (process.env.BRIEFING_SHARE_SECRET || process.env.AUTH_SECRET || "").trim() || null;
}

export function briefingShareEnabled(): boolean {
  return shareSecret() !== null;
}

export interface BriefingShareParams {
  org: string;
  range?: string;
  from?: string;
  to?: string;
  // EXEC #1: the per-client segment scope travels in the signed token so the shared read-only page
  // re-runs buildExecBriefing scoped to the SAME client the owner shared, not the whole org.
  segment?: string;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a `payload.sig` token carrying the org + window, valid for `ttlMs`. Null without a secret. */
export function signBriefingShareToken(p: BriefingShareParams, ttlMs: number = DEFAULT_TTL_MS): { token: string; expiresAt: number } | null {
  const secret = shareSecret();
  if (!secret) return null;
  const expiresAt = Date.now() + ttlMs;
  const payload = Buffer.from(
    JSON.stringify({ org: p.org.toLowerCase(), range: p.range, from: p.from, to: p.to, segment: p.segment, exp: expiresAt }),
  ).toString("base64url");
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

/** Verify a share token: signature must match (timing-safe) and it must not be expired. */
export function verifyBriefingShareToken(token: string): BriefingShareParams | null {
  const secret = shareSecret();
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      org?: unknown;
      range?: unknown;
      from?: unknown;
      to?: unknown;
      segment?: unknown;
      exp?: unknown;
    };
    if (typeof p.org !== "string" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return {
      org: p.org,
      range: typeof p.range === "string" ? p.range : undefined,
      from: typeof p.from === "string" ? p.from : undefined,
      to: typeof p.to === "string" ? p.to : undefined,
      segment: typeof p.segment === "string" ? p.segment : undefined,
    };
  } catch {
    return null;
  }
}
