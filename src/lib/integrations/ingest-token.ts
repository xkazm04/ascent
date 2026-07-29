// Per-org ingest token for the Claude Code OTel push path. The mac is a self-describing HMAC over the
// slug, so the token stays cheap to verify — nothing to store, nothing to leak (the secret never
// leaves the server).
//
// REVOCATION EPOCH. The token now also carries the per-org epoch it was minted at, exactly the shape
// SessionRevocation uses for the session cookie's `sv`: the value is baked into the signed material
// AND compared against the stored `Organization.ingestTokenEpoch`, so a token minted at a lower epoch
// is rejected the moment the org bumps. That is the difference between "an owner pasted the token
// into a Slack thread" being a one-click fix and being a server-wide secret rotation that silently
// re-derives EVERY other org's token at the same time.
//
// WIRE FORMAT (both accepted; epoch 0 is byte-for-byte the pre-epoch token, so nothing re-onboards):
//   epoch 0 : asc_otel.<slug>.<mac>              mac = HMAC(secret, "otel:<slug>")
//   epoch N : asc_otel.<slug>.e<N>.<mac>         mac = HMAC(secret, "otel:<slug>:e<N>")
// The epoch is INSIDE the signed material, so a caller can't relabel an old mac with a higher epoch.
// Rotating INTEGRATIONS_INGEST_SECRET remains the break-glass that invalidates every org at once.
//
// Server-only (node:crypto). The page derives the token and passes the string to the client panel;
// the client never imports this module.

import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "asc_otel";
// A stable server secret. Prefer a dedicated var; fall back to ENCRYPTION_KEY, then a clearly-marked
// dev default so the local demo shows a working token. Rotating the secret rotates every org's token.
const SECRET = process.env.INTEGRATIONS_INGEST_SECRET || process.env.ENCRYPTION_KEY || "ascent-dev-integrations-secret";

/** Signed material for (slug, epoch). Epoch 0 keeps the original input verbatim — that is what makes
 *  every already-issued token keep verifying. */
function mac(slug: string, epoch: number): string {
  const material = epoch > 0 ? `otel:${slug}:e${epoch}` : `otel:${slug}`;
  return createHmac("sha256", SECRET).update(material).digest("hex").slice(0, 32);
}

/** Normalize an untrusted epoch to a non-negative integer. */
function normEpoch(epoch: number | undefined): number {
  return typeof epoch === "number" && Number.isInteger(epoch) && epoch > 0 ? epoch : 0;
}

/** The org's ingest token at `epoch` — safe to display to an owner and paste into their OTel exporter
 *  headers. Epoch 0 (never rotated) yields the original 3-segment form. */
export function ingestToken(slug: string, epoch = 0): string {
  const e = normEpoch(epoch);
  return e > 0 ? `${PREFIX}.${slug}.e${e}.${mac(slug, e)}` : `${PREFIX}.${slug}.${mac(slug, 0)}`;
}

/** Pull the ingest token from an `Authorization: Bearer …` header, falling back to a custom header. */
export function bearerToken(authorization: string | null, fallback?: string | null): string | null {
  const m = (authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : (fallback ?? null);
}

export interface IngestClaim {
  slug: string;
  /** The epoch this token was minted at — checked against the org's stored epoch by the ingest guard. */
  epoch: number;
}

/**
 * Verify an inbound token's SIGNATURE and recover the org slug + minted epoch, or null if
 * forged/malformed. Deliberately pure and synchronous (no DB): whether that epoch is still CURRENT is
 * a separate, stateful check — see `authorizeIngest` in ingest-guard.ts. Both must pass.
 */
export function parseIngestToken(token: string): IngestClaim | null {
  const parts = token.trim().split(".");
  if (parts[0] !== PREFIX) return null;

  let slug: string | undefined;
  let epoch = 0;
  let provided: string | undefined;
  if (parts.length === 3) {
    [, slug, provided] = parts;
  } else if (parts.length === 4) {
    slug = parts[1];
    provided = parts[3];
    const m = /^e([1-9]\d{0,8})$/.exec(parts[2] ?? "");
    if (!m) return null;
    epoch = Number(m[1]);
  } else {
    return null;
  }
  if (!slug || !provided) return null;

  const expected = mac(slug, epoch);
  if (provided.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return { slug, epoch };
}
