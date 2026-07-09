// Signed, expiring, REVOCABLE read-only share tokens for the live war-room (WAR-4) — so an owner can put
// their fleet wall on an unauthenticated TV/kiosk without exposing a session. The token IS the capability:
// an HMAC-signed `{aud, org, jti, exp, mintedBy?}` payload. The shared page (/live/shared/[token]) verifies
// it and renders the wall READ-ONLY (no scan trigger — /api/org/scan stays session-gated), exposing only the
// same org rollup the dashboard shows. Inert (mint returns null / verify fails) without a signing secret.
//
// Three defenses the original stateless `{org, exp}` token lacked (live-war-room #1/#2/#4):
//   • DOMAIN SEPARATION (#4) — the HMAC message is prefixed with DOMAIN, and the payload carries `aud`.
//     A session cookie (auth.ts signs base64url(json) with the SAME default AUTH_SECRET, no prefix) can
//     therefore never be a signature-valid share token, and vice versa — closing the latent cross-protocol
//     token confusion that previously rested only on the two payloads never sharing a required field. The
//     old scheme signed the bare payload, byte-identical to a session cookie.
//   • PER-LINK REVOCATION (#1) — every mint stamps a random `jti`; a single link is killed by recording
//     that jti as revoked (src/lib/db/org-share.ts), enforced on READ. This is the per-link kill switch the
//     stateless token lacked, WITHOUT rotating the global secret (which defaults to AUTH_SECRET and would
//     sign out every user). verifyLiveShareToken accepts an injected `revoked` predicate so a caller can
//     enforce the stored revocation state inside verify (and tests can exercise it with no DB).
//   • OWNER BINDING (#1) — like briefing-share (EXEC #5), an optional `mintedBy` login lets the page honor
//     the link only while its minter still holds owner access (reusing the members store — no schema
//     change); removing/demoting them kills their links. Set only under the enforced Supabase wall; other
//     auth modes leave it undefined and keep the prior unbound behavior.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Domain-separation label mixed into the HMAC message AND carried as `aud`. Bumping the version is a
// deliberate GLOBAL cut-over lever (invalidates every previously-minted link) — distinct from the per-link
// jti revocation and the owner binding, neither of which touches the secret.
const DOMAIN = "live-share.v1";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — a kiosk wall's working life
// Hard UPPER cap: a caller may SHORTEN the life of a link (or even mint an already-dead one for testing)
// but can never mint one that outlives a month un-revoked, bounding the exposure window of a link that
// escapes before anyone thinks to revoke it.
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Signing secret: a dedicated LIVE_SHARE_SECRET, else the existing AUTH_SECRET. Null = sharing off. */
function shareSecret(): string | null {
  return (process.env.LIVE_SHARE_SECRET || process.env.AUTH_SECRET || "").trim() || null;
}

export function liveShareEnabled(): boolean {
  return shareSecret() !== null;
}

export interface LiveShareClaims {
  org: string;
  /** Per-link id — the handle the per-link kill switch (org-share.ts) revokes. */
  jti: string;
  /** GitHub login of the minting owner (owner-binding revocation lever); set only under the Supabase wall. */
  mintedBy?: string;
}

export interface SignLiveShareOptions {
  /** Time-to-live in ms. Clamped to (0, MAX_TTL_MS]; defaults to DEFAULT_TTL_MS. Caller-settable (#1). */
  ttlMs?: number;
  /** Bind the link to this owner login so losing owner access revokes it (see page enforcement). */
  mintedBy?: string;
}

// The HMAC is over `${DOMAIN}.${payload}` — the domain prefix is what makes a session cookie's HMAC (same
// secret, NO prefix) never collide with a share token's. Do not drop the prefix without bumping DOMAIN.
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${DOMAIN}.${payload}`).digest("base64url");
}

/**
 * Mint a `payload.sig` token for `org`, valid for the given TTL (default 7d, hard-capped at 30d), stamped
 * with a fresh `jti` (per-link revocation handle) and an optional `mintedBy` owner binding. Null when no
 * signing secret is configured. The second arg is either a raw `ttlMs` number (legacy) or an options bag.
 */
export function signLiveShareToken(
  org: string,
  ttlOrOpts: number | SignLiveShareOptions = {},
): { token: string; expiresAt: number; jti: string } | null {
  const opts: SignLiveShareOptions = typeof ttlOrOpts === "number" ? { ttlMs: ttlOrOpts } : ttlOrOpts;
  const secret = shareSecret();
  if (!secret) return null;
  // Only the UPPER bound is clamped: a caller may still request a short (or negative → already-expired) TTL.
  const ttl = Math.min(opts.ttlMs ?? DEFAULT_TTL_MS, MAX_TTL_MS);
  const expiresAt = Date.now() + ttl;
  const jti = randomUUID();
  const payload = Buffer.from(
    JSON.stringify({ aud: DOMAIN, org: org.toLowerCase(), jti, mintedBy: opts.mintedBy, exp: expiresAt }),
  ).toString("base64url");
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt, jti };
}

/**
 * Verify a share token: the domain-scoped signature must match (timing-safe), the `aud` must be ours, it
 * must not be expired (expiry enforced on READ, not merely at mint), and — when a `revoked` predicate is
 * supplied — its `jti` must not be revoked. Returns the claims or null.
 *
 * `opts.revoked` is the injection seam for per-link revocation: the shared page passes a predicate closed
 * over the stored revocation state (and unit tests pass a literal), so the "immediately refuse a killed
 * link" check lives in this one pure function. `opts.now` overrides the clock for deterministic tests.
 */
export function verifyLiveShareToken(
  token: string,
  opts: { revoked?: (jti: string) => boolean; now?: number } = {},
): LiveShareClaims | null {
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
      aud?: unknown;
      org?: unknown;
      jti?: unknown;
      mintedBy?: unknown;
      exp?: unknown;
    };
    // Audience check — belt-and-braces over the HMAC domain prefix: a signature-valid token minted for a
    // DIFFERENT purpose (or a pre-domain-separation legacy live-share token) carries no/other `aud` and is
    // refused rather than honored as a war-room capability.
    if (p.aud !== DOMAIN) return null;
    if (typeof p.org !== "string" || typeof p.jti !== "string") return null;
    const now = opts.now ?? Date.now();
    if (typeof p.exp !== "number" || p.exp < now) return null; // exp enforced HERE, on every read
    if (opts.revoked?.(p.jti)) return null; // per-link kill switch — no global secret rotation needed
    return { org: p.org, jti: p.jti, mintedBy: typeof p.mintedBy === "string" ? p.mintedBy : undefined };
  } catch {
    return null;
  }
}
