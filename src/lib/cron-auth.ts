// Shared CRON_SECRET auth gate for the scheduled (Vercel Cron) routes — /api/cron/{purge,digest,rescan}.
// Single-sourced so the three handlers can't drift apart, and so the fail-closed contract lives in ONE
// place: a missing/empty CRON_SECRET must REFUSE (503), never silently disable auth. The check used to be
// opt-in (`if (secret)`) inline in each route, so a forgotten env var on a new deploy quietly left these
// unattended, high-blast-radius endpoints (the DELETE-everything purge, the token-minting rescan, the
// external alert push) open. Refuse rather than run unauthed.

import { NextResponse } from "next/server";

/**
 * Guard a cron route against the shared CRON_SECRET. Returns a ready-to-send error response when auth
 * FAILS — 503 if CRON_SECRET is unset/empty (fail CLOSED), 401 for a wrong/absent credential — or
 * `null` when the request is authorized and the handler should proceed.
 *
 * Accepts either an `Authorization: Bearer ${CRON_SECRET}` header or a `?key=${CRON_SECRET}` query
 * param (Vercel Cron sends the bearer; the query form supports manual/retry invocations).
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron is not configured (CRON_SECRET unset)." }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
