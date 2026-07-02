// Canonical reader for boolean environment-variable flags.
//
// Historically the four-character idiom `const v = process.env.X; return v === "1" || v === "true";`
// was hand-rolled in ~10 places (auth bypass, org-dashboard open, plan/credit-grant gates, the public
// scan-quota kill switch, etc.), so the accepted truthy set lived in ten copies. This is the one place
// that defines it. The accepted truthy set is exactly `"1"` and `"true"` (case-sensitive, no
// whitespace trimming) — the form the majority of call sites used — so routing them here is
// behavior-preserving.
//
// Pure (reads only `process.env`); safe to import from server modules, client-adjacent modules, and
// the next/headers-free proxy alike.

/** True iff the given env var is set to one of the accepted truthy tokens (`"1"` or `"true"`). */
export function envBool(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

// ── Auth-gate env predicates ─────────────────────────────────────────────────
// Pure (process.env only) so BOTH the server-only access gate (src/lib/access.ts, which can't run in
// the proxy) and the next/headers-free proxy (src/proxy.ts) read one definition instead of two copies.

/** Whether Supabase auth is wired up (public URL + anon key present). */
export function supabaseAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Dev/local escape hatch: when set, the login wall is dropped — HARD-DISABLED in production so a
 *  single stray `ASCENT_AUTH_BYPASS` env var can never drop the wall on a real deployment. */
export function authBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return envBool("ASCENT_AUTH_BYPASS");
}

/**
 * Whether the login wall is actually enforced right now: Supabase configured AND the dev bypass off.
 * The COMPOSED predicate lives here (next/headers-free) alongside its two operands so the server gate
 * (src/lib/access.ts, which re-exports it) and the proxy's cookie-refresh decision (src/proxy.ts) share
 * ONE definition. Previously the proxy re-implemented this composition by hand, so adding a condition
 * here would silently diverge the two — the drift this consolidation exists to prevent.
 */
export function authGateEnabled(): boolean {
  return supabaseAuthConfigured() && !authBypassEnabled();
}
