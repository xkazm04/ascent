// Shared ASCENT_SEED_SECRET gate for the /api/dev/seed-* routes (seed-fleet, seed-history,
// seed-vercel-demo, seed-ai-usage). Four routes open-coded the same nine lines, and every one of them
// compared the presented credential with `===` — the only credential comparisons left in src/ that do.
// Every other secret in this repo (CRON_SECRET in cron-auth.ts, the conformance ingest token, the
// session HMAC, the OAuth state, the org API tokens, the audit-chain MAC) is compared with
// crypto.timingSafeEqual behind a length pre-check, and cron-auth.test.ts pins that with an assertion
// that `===` is never used. These routes are the ones the comparison matters most for: ASCENT_SEED_SECRET
// exists specifically so the seeders can be run ONCE against a DEPLOYED instance, so the comparison is
// reachable over the network by an unauthenticated caller.
//
// Behaviour is otherwise unchanged from the four copies: a configured secret must be presented (header
// or query param); with NO secret configured the routes are allowed only outside production, so a bare
// prod deploy cannot be seeded by anyone.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/** The header the seed scripts send. The `?secret=` query form is accepted too (curl convenience). */
export const SEED_SECRET_HEADER = "x-seed-secret";

/**
 * Constant-time string compare. A length mismatch returns false WITHOUT calling timingSafeEqual
 * (which throws on unequal-length buffers) — the length is not the secret. Mirrors
 * `secretMatches` in src/lib/cron-auth.ts.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * May this request run a dev seeder?
 *
 * - `ASCENT_SEED_SECRET` set → the caller must present it (constant-time compare).
 * - unset → allowed only outside production.
 */
export function seedRequestAuthorized(req: NextRequest): boolean {
  const secret = process.env.ASCENT_SEED_SECRET?.trim();
  if (secret) {
    const provided =
      req.headers.get(SEED_SECRET_HEADER) ?? new URL(req.url).searchParams.get("secret");
    return provided !== null && secretMatches(provided, secret);
  }
  return process.env.NODE_ENV !== "production";
}
