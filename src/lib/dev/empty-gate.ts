// Pure seed-gate predicate for the reproducible EMPTY-tenant dev mode (`npm run dev:empty`).
//
// `scripts/dev-empty.mjs` launches a second dev server with `ASCENT_EMPTY=1` pointed at a throwaway
// PGlite dir (`.pglite/ascent-empty`) so the new-user onboarding flow can be exercised against a
// schema-only, zero-row database. Ascent has NO boot-time sample seeding today (seeding happens only
// via explicit scripts / dev API routes), so nothing needs suppressing yet — this predicate is the
// single gate any FUTURE automatic dev seeding, demo bootstrap, or onboarding-checklist stamp must
// consult before writing rows, so the empty tenant stays empty by construction.
//
// Pure by contract: reads only the env bag it is handed (defaulting to `process.env`), no I/O — safe
// to import anywhere, trivially unit-testable. Deliberately more lenient than `envBool` in
// src/lib/env.ts ("1"/"true" only): a dev-only launcher flag set by hand tolerates "yes"/"on" and
// case/whitespace slop; nothing security-relevant hangs off it.

/** Truthy tokens accepted for `ASCENT_EMPTY` (case-insensitive, trimmed). */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * True iff the empty-tenant dev mode is active — i.e. `ASCENT_EMPTY` is set to one of
 * "1" / "true" / "yes" / "on" (case-insensitive, surrounding whitespace ignored).
 * Anything else — unset, "", "0", "false", "off", garbage — is false.
 */
export function emptyTenantEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.ASCENT_EMPTY;
  if (v == null) return false;
  return TRUTHY.has(v.trim().toLowerCase());
}
