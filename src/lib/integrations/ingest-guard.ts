// Shared hardening for the PUBLIC, internet-facing ingest surface (/api/integrations/ingest and its
// /v1/metrics + /v1/logs sub-routes). These are the only routes in the app an anonymous caller can
// POST a body to with nothing but a bearer token, so they get the same two guards the rest of the
// public funnel already has — a declared body cap and the shared sliding-window rate limiter — rather
// than a second, parallel implementation of either.
//
// BODY CAP. Every ingest route used to `await req.text()` unbounded: a single request could pin an
// instance's memory with an arbitrarily large payload, and the protobuf-refusal path drained the body
// unbounded *just to close the socket cleanly*. `readCappedBody` streams instead, aborting the moment
// the byte count passes MAX_BODY (and short-circuiting on a declared content-length), so an oversized
// push costs one chunk, not the whole payload. Same shape as the MAX_BODY constant in
// src/app/api/org/issue/route.ts — a named ceiling checked before the value is used.
//
// RATE LIMIT. Layered on src/lib/rate-limit.ts (NOT a fork): the same per-IP burst window + global
// per-instance ceiling, with a shared-store-aware global when one is configured. See
// INGEST_RATE_LIMIT below for how the ceiling is derived from Claude Code's real push cadence.
//
// Server-only (node crypto via ingest-token, and the module-global limiter state).

import { rateLimitRequestShared, tooManyRequests, type RateLimitConfig } from "@/lib/rate-limit";
import { bearerToken, parseIngestToken } from "@/lib/integrations/ingest-token";
import { getIngestTokenEpoch } from "@/lib/db/integrations";

/**
 * Max accepted ingest body. An OTLP/JSON metrics export from Claude Code is a few KB — a handful of
 * `claude_code.*` counters on one resource. Even a collector fanning in hundreds of developer
 * machines batches well under this. 1 MB is ~2 orders of magnitude of headroom over the real payload
 * while still bounding a hostile one. Mirrors the MAX_BODY convention in /api/org/issue.
 */
export const MAX_BODY = 1_000_000;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * CEILING DERIVATION — a limit tuned to "an API is usually quiet" would break a legitimate exporter,
 * so this is derived from the push cadence the connect snippet actually produces.
 *
 * Claude Code's OTel exporter flushes metrics on OTEL_METRIC_EXPORT_INTERVAL (60s by default) and
 * logs on OTEL_LOGS_EXPORT_INTERVAL (5s by default) — so ONE developer machine sends ~1 metrics push
 * + ~12 log pushes per minute, and all of them land on this limiter's namespace. A 200-seat
 * engineering org behind ONE office/VPN egress IP therefore produces ~2,600 requests/minute at the
 * defaults, and a team that lowers the metric interval to 10s produces more. The per-IP cap is set
 * to 3,000/min so that shape passes with headroom; the global per-instance ceiling is 20,000/min,
 * which still bounds a flood (each request costs a JSON parse plus a small upsert batch) without
 * capping a plausible multi-tenant instance. Both env-overridable so an operator with an unusual
 * fan-in shape can raise them without a deploy.
 */
export const INGEST_RATE_LIMIT: RateLimitConfig = {
  name: "integrations-ingest",
  perIp: envInt("RATE_LIMIT_INGEST_PER_IP", 3_000),
  global: envInt("RATE_LIMIT_INGEST_GLOBAL", 20_000),
  windowMs: 60_000,
};

/**
 * Read the request body with a hard byte ceiling. Returns `{ ok: false }` once the payload exceeds
 * `max` — the caller turns that into a 413. Never throws: a torn connection yields the bytes read so
 * far, exactly like the `req.text().catch(() => "")` it replaces.
 */
export async function readCappedBody(req: Request, max = MAX_BODY): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(req.headers.get("content-length"));
  // Trust the declared length only to REJECT early (a lying small value is still caught by the
  // streaming count below).
  if (Number.isFinite(declared) && declared > max) return { ok: false };

  const stream = req.body;
  if (!stream) {
    const text = await req.text().catch(() => "");
    return text.length > max ? { ok: false } : { ok: true, text };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value?.byteLength ?? 0;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      if (value) text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    /* torn connection — keep whatever arrived, same as the old .catch(() => "") */
  }
  return { ok: true, text };
}

/** The shared 413 for an over-cap ingest body. */
export function payloadTooLarge(): Response {
  return new Response(
    JSON.stringify({ error: `Payload too large — ingest bodies are capped at ${MAX_BODY} bytes. Reduce the OTel export batch size.` }),
    { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

/** The shared 401 for a missing/forged ingest token. */
export function unauthorizedIngest(): Response {
  return new Response(JSON.stringify({ error: "Missing or invalid ingest token." }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** The 401 for a token whose signature is fine but whose epoch has been rotated away. Distinct copy,
 *  same status: the exporter's operator needs to know the fix is "paste the NEW token", not "check
 *  your typing" — but a caller must not be able to distinguish a revoked org from a forged mac by
 *  status code alone, so both are 401. */
export function revokedIngest(): Response {
  return new Response(
    JSON.stringify({ error: "This ingest token has been regenerated. Copy the current token from the org's Integrations page and update your exporter." }),
    { status: 401, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

/**
 * The common front door for every ingest route, in the ONE order that stays honest:
 *   1. rate limit (429) — charged before any crypto or body read, so a flood is cheap to refuse and
 *      the guard covers unauthenticated callers too;
 *   2. signature verification (401) — so wire-format/parse behavior below never leaks to an anonymous
 *      caller (a bad-token protobuf push gets 401, NOT 415);
 *   3. revocation check (401) — the token's minted epoch must be >= the org's stored epoch. A token
 *      the owner has regenerated away stops working on the very next request, with no wait-out
 *      window. If the epoch can't be read while the DB is configured, refuse with 503 rather than
 *      assume 0: "revocation state unknown" must never resolve to "accept the old token".
 * Returns a `Response` to send back, or the authorized org slug to proceed with.
 */
export async function guardIngest(req: Request): Promise<{ deny: Response } | { deny?: undefined; slug: string }> {
  const rl = await rateLimitRequestShared(req, INGEST_RATE_LIMIT);
  if (!rl.ok) return { deny: tooManyRequests(rl.retryAfterSec) };

  const token = bearerToken(req.headers.get("authorization"), req.headers.get("x-ascent-ingest-token"));
  const parsed = token ? parseIngestToken(token) : null;
  if (!parsed) return { deny: unauthorizedIngest() };

  const current = await getIngestTokenEpoch(parsed.slug);
  if (current === null) {
    return {
      deny: new Response(JSON.stringify({ error: "Can't verify token status right now — retry shortly." }), {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8", "retry-after": "30" },
      }),
    };
  }
  if (parsed.epoch < current) return { deny: revokedIngest() };
  return { slug: parsed.slug };
}
