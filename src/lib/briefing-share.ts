// Signed, expiring read-only share tokens for the executive briefing (EXEC-6) — so an owner can send
// a board member a briefing without giving them an account. The token IS the capability: an
// HMAC-signed `{org, range, from, to, exp}` payload (the window travels so the recipient sees the same
// period). The shared page (/share/briefing/[token]) verifies it and re-runs buildExecBriefing
// READ-ONLY, exposing only what the briefing tab shows. Inert without a signing secret. The HMAC
// framing is shared with lib/live-share.ts (WAR-4) via lib/signed-share.ts.

import { resolveShareSecret, signShareToken, verifyShareToken } from "./signed-share";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — a board cycle; shortened from 14d to bound a leaked link's exposure window (briefing-share #5)

/** Signing secret: a dedicated BRIEFING_SHARE_SECRET, else the existing AUTH_SECRET. Null = off. */
function shareSecret(): string | null {
  return resolveShareSecret("BRIEFING_SHARE_SECRET");
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
  // Feature 3b: the tech-stack group KEY travels too, so a "Frontend briefing" share stays scoped.
  stack?: string;
  // briefing-share #5: the GitHub login of the OWNER who minted the link. Carried so the shared page can
  // bind the (otherwise un-revocable) stateless token to that owner's continued authority — when set, the
  // link is honored only while `mintedBy` still holds owner access, so removing/demoting them kills their
  // shared links. Set only under the enforced Supabase wall (where membership is the seeded source of
  // truth); other auth modes leave it undefined and keep the prior stateless behavior.
  mintedBy?: string;
}

/** Mint a `payload.sig` token carrying the org + window, valid for `ttlMs`. Null without a secret. */
export function signBriefingShareToken(p: BriefingShareParams, ttlMs: number = DEFAULT_TTL_MS): { token: string; expiresAt: number } | null {
  const secret = shareSecret();
  if (!secret) return null;
  const expiresAt = Date.now() + ttlMs;
  const token = signShareToken(
    { org: p.org.toLowerCase(), range: p.range, from: p.from, to: p.to, segment: p.segment, stack: p.stack, mintedBy: p.mintedBy, exp: expiresAt },
    secret,
  );
  return { token, expiresAt };
}

/** Verify a share token: signature must match (timing-safe) and it must not be expired. */
export function verifyBriefingShareToken(token: string): BriefingShareParams | null {
  const p = verifyShareToken(token, shareSecret()) as {
    org?: unknown;
    range?: unknown;
    from?: unknown;
    to?: unknown;
    segment?: unknown;
    stack?: unknown;
    mintedBy?: unknown;
    exp?: unknown;
  } | null;
  if (!p) return null;
  if (typeof p.org !== "string" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return {
    org: p.org,
    range: typeof p.range === "string" ? p.range : undefined,
    from: typeof p.from === "string" ? p.from : undefined,
    to: typeof p.to === "string" ? p.to : undefined,
    segment: typeof p.segment === "string" ? p.segment : undefined,
    stack: typeof p.stack === "string" ? p.stack : undefined,
    mintedBy: typeof p.mintedBy === "string" ? p.mintedBy : undefined,
  };
}
