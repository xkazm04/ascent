// Shared CRON_SECRET auth gate for the scheduled (Vercel Cron) routes — /api/cron/{purge,digest,rescan}.
// Single-sourced so the three handlers can't drift apart, and so the fail-closed contract lives in ONE
// place: a missing/empty CRON_SECRET must REFUSE (503), never silently disable auth. The check used to be
// opt-in (`if (secret)`) inline in each route, so a forgotten env var on a new deploy quietly left these
// unattended, high-blast-radius endpoints (the DELETE-everything purge, the token-minting rescan, the
// external alert push) open. Refuse rather than run unauthed.
//
// G8-48 — this helper used to be WEAKER than the gates it was meant to replace: it accepted the secret
// as a `?key=` query param and compared with a plain `!==`. /api/cron/{purge,digest} therefore hand-rolled
// a stricter check (header-only + timingSafeEqual) rather than adopt a helper that would have re-opened
// both holes. The canonical gate is now the STRICT one, and those two routes call it.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Constant-time compare for the cron secret. A length mismatch returns false WITHOUT calling
 * timingSafeEqual (which throws on unequal-length buffers) — the length is not the secret. Replaces a
 * plain `!==`, which is a timing oracle on tokens that authorize a DELETE-everything purge, a
 * fleet-data-to-external-webhook push, and a per-org token-minting rescan.
 */
export function cronSecretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Legacy escape hatch for the removed `?key=<secret>` channel. Default OFF: query strings are routinely
 * captured by access/CDN/proxy logs, browser history and Referer headers, so a secret on that channel can
 * authorize a destructive purge from places the Authorization header never reaches. Vercel Cron itself
 * sends the bearer (vercel.json declares paths only, no query string), so nothing scheduled depends on it
 * — this exists solely so a deployment whose own manual/retry tooling still sends `?key=` can re-enable it
 * for one deploy while that tooling is fixed. Every accepted query-param auth logs a deprecation warning.
 */
function queryKeyAllowed(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.CRON_ALLOW_QUERY_KEY ?? "");
}

/**
 * Guard a cron route against the shared CRON_SECRET. Returns a ready-to-send error response when auth
 * FAILS — 503 if CRON_SECRET is unset/empty (fail CLOSED), 401 for a wrong/absent credential — or
 * `null` when the request is authorized and the handler should proceed.
 *
 * Accepts ONLY an `Authorization: Bearer ${CRON_SECRET}` header (what Vercel Cron sends), compared in
 * constant time. The `?key=${CRON_SECRET}` query form is accepted only when CRON_ALLOW_QUERY_KEY is
 * explicitly set, and warns when it is.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron is not configured (CRON_SECRET unset)." }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (presented && cronSecretMatches(presented, secret)) return null;
  if (queryKeyAllowed()) {
    const key = new URL(request.url).searchParams.get("key");
    if (key && cronSecretMatches(key, secret)) {
      console.warn(
        "[cron-auth] DEPRECATED: CRON_SECRET accepted from the ?key= query param (CRON_ALLOW_QUERY_KEY). " +
          "Query strings leak into access/CDN/proxy logs and Referer headers — move the caller to " +
          "`Authorization: Bearer <secret>` and unset CRON_ALLOW_QUERY_KEY.",
      );
      return null;
    }
  }
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}
