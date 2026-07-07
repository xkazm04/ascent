// Per-org ingest token for the Claude Code OTel push path. Stateless by design: the token is a
// self-describing `asc_otel.<slug>.<mac>` where mac = HMAC-SHA256(secret, "otel:<slug>"). We can hand
// it to a customer and later verify inbound telemetry by re-deriving the mac from the slug in the
// token — nothing to store, nothing to leak (the secret never leaves the server). This is why Claude
// Code can be "connected" in the first increment without a schema migration.
//
// Server-only (node:crypto). The page derives the token and passes the string to the client panel;
// the client never imports this module.

import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "asc_otel";
// A stable server secret. Prefer a dedicated var; fall back to ENCRYPTION_KEY, then a clearly-marked
// dev default so the local demo shows a working token. Rotating the secret rotates every org's token.
const SECRET = process.env.INTEGRATIONS_INGEST_SECRET || process.env.ENCRYPTION_KEY || "ascent-dev-integrations-secret";

function mac(slug: string): string {
  return createHmac("sha256", SECRET).update(`otel:${slug}`).digest("hex").slice(0, 32);
}

/** The org's ingest token — safe to display to an owner and paste into their OTel exporter headers. */
export function ingestToken(slug: string): string {
  return `${PREFIX}.${slug}.${mac(slug)}`;
}

/** Pull the ingest token from an `Authorization: Bearer …` header, falling back to a custom header. */
export function bearerToken(authorization: string | null, fallback?: string | null): string | null {
  const m = (authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : (fallback ?? null);
}

/** Verify an inbound token and recover the org slug it authorizes, or null if forged/malformed. */
export function parseIngestToken(token: string): { slug: string } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, slug, provided] = parts;
  if (!slug || !provided) return null;
  const expected = mac(slug);
  if (provided.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return { slug };
}
