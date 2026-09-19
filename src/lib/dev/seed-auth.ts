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
// Empty-tenant refuse: `ASCENT_EMPTY` (`emptyTenantEnabled`) is a restriction, not an escape hatch —
// it keeps `npm run dev:empty`'s throwaway tenant empty by construction. It is checked FIRST and
// honored even in production and even when a valid seed secret is presented, so a seed script pointed
// at :3005 cannot populate the empty tenant. There is no production floor on the empty flag: flooring
// it to false would re-open seed writes. The production floor that DOES belong here is the existing
// one on the secret-less path: with no `ASCENT_SEED_SECRET` the routes are allowed only outside
// production, so a bare prod deploy cannot be seeded by anyone.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { emptyTenantEnabled } from "./empty-gate";

/** The header the seed scripts send. The `?secret=` query form is accepted too (curl convenience). */
export const SEED_SECRET_HEADER = "x-seed-secret";

const SECRET_REFUSAL =
  "forbidden: set ASCENT_SEED_SECRET and pass it via the x-seed-secret header or ?secret=";
const EMPTY_TENANT_REFUSAL = "forbidden: seed writes are refused while ASCENT_EMPTY is on";

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
 * 403 body for a refused seed write. Distinguishes the empty-tenant refuse from a missing/wrong
 * secret so an operator hitting :3005 is not told to set a secret they already have.
 */
export function seedForbiddenMessage(): string {
  return emptyTenantEnabled() ? EMPTY_TENANT_REFUSAL : SECRET_REFUSAL;
}

/**
 * May this request run a dev seeder?
 *
 * - `ASCENT_EMPTY` on → refused (empty tenant stays empty; not an escape hatch, no production floor).
 * - `ASCENT_SEED_SECRET` set → the caller must present it (constant-time compare).
 * - unset → allowed only outside production.
 */
export function seedRequestAuthorized(req: NextRequest): boolean {
  if (emptyTenantEnabled()) return false;
  const secret = process.env.ASCENT_SEED_SECRET?.trim();
  if (secret) {
    const provided =
      req.headers.get(SEED_SECRET_HEADER) ?? new URL(req.url).searchParams.get("secret");
    return provided !== null && secretMatches(provided, secret);
  }
  return process.env.NODE_ENV !== "production";
}
