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

// ── Deployment-mode predicate ────────────────────────────────────────────────

/**
 * Whether this deployment SELLS plans — i.e. whether a Polar server token is present. Read as a bare
 * env string rather than through `@/lib/polar` on purpose: this module must stay importable from
 * `@/lib/plans`, which client components import for its DATA constants, and pulling the Polar SDK
 * across that boundary would drag a server-only dependency into the browser bundle.
 */
function billingConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN?.trim());
}

/**
 * Whether Ascent is running as a SELF-HOSTED deployment — the open-source path, where the operator
 * owns the keys, the model, the database and the bill.
 *
 * Ascent is AGPL-3.0 software whose cloud sells OPERATION, not features. That promise has to be true
 * in code, not just on the pricing page: on a self-hosted deployment every plan gate is off (BYOM,
 * white-label, skills, memory, PDF export), scans are unmetered, and retention is unbounded. The tier
 * model still EXISTS — a self-hoster can run Ascent Cloud's exact code — it just isn't enforced.
 *
 * Resolution order, so that the common cases need no configuration at all:
 *   1. `ASCENT_SELF_HOSTED=1|true`  → self-hosted (force it on: a private cloud that also sells
 *      nothing internally, or a staging clone of the production env that must not meter).
 *   2. `ASCENT_SELF_HOSTED=0|false` → NOT self-hosted (force it off: the hosted product, and the unit
 *      suite, which asserts CLOUD-mode gating — see the `env` block in vitest.config.js).
 *   3. unset → **self-hosted iff billing is not configured**. A fresh `git clone && npm run dev` has
 *      no `POLAR_ACCESS_TOKEN`, so it gets the full product immediately instead of silently landing
 *      on the Free tier's 5-scan allowance with the marquee features greyed out — which is exactly
 *      the first-run experience an open-source-first project cannot afford.
 *
 * SERVER-SIDE ONLY. Every caller (the `planAllows*` gates, `isMeteredScan`) runs in a route handler,
 * a server component, or the db layer; no client component calls a gate — they import only the plan
 * DATA constants (verified: `PlanControl.tsx`, `CreditsControl.sections.tsx`). Were one to call a
 * gate, `process.env.POLAR_ACCESS_TOKEN` is undefined in the browser and this would wrongly report
 * self-hosted, so keep gate evaluation on the server and pass the boolean down as a prop.
 */
export function selfHosted(): boolean {
  const raw = process.env.ASCENT_SELF_HOSTED?.trim().toLowerCase();
  // Deliberately NOT envBool: this flag needs a third state. `envBool` cannot distinguish "unset"
  // (fall through to the billing sniff) from an explicit "0" (the operator says: enforce plans).
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return !billingConfigured();
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
 * Whether the self-serve manual credit-grant endpoint (POST /api/org/credits/grant) is open —
 * HARD-DISABLED in production, exactly like `authBypassEnabled` above, so a single stray
 * `ASCENT_ALLOW_CREDIT_GRANTS` (misconfiguration, leaked env, a staging env reused for a real
 * deployment) can never open a credit mint on a real deployment. In production, credits move ONLY via
 * the Polar top-up webhook. The guard lives HERE, not at the route, so the flag has one definition and
 * the production floor cannot be lost by a caller reading the raw env var instead.
 */
export function creditGrantsEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return envBool("ASCENT_ALLOW_CREDIT_GRANTS");
}

/**
 * Whether the ANONYMOUS PUBLIC scan funnel is walled behind sign-in. Opt-in, default OFF.
 *
 * UAT TOMAS-L1-01 (blocker). The public funnel used to inherit the general sign-in wall, so in
 * production `POST /api/scan` on a public repo answered
 * `401 {"code":"auth_required"}` — while everything READ-ONLY stayed open (saved report 200, badge
 * 200, gate 422). The one walled action was the only one that converts a buyer, under a landing CTA
 * reading "Scan a repository" and a README section headed "Free & public — no signup: everything
 * here works anonymously". The scan route's own comment two hundred lines above the wall already
 * said "anonymous public scans stay free and no-signup" — the code and its stated intent had drifted.
 *
 * So the default now matches the promise, and re-walling is a deliberate operator act (set
 * `ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN=1`) rather than an accident of inheriting a gate meant for
 * private scans. Anonymous public scans remain bounded by the two limits that were always the real
 * cost ceiling — the shared per-IP/global burst limiter and the rolling monthly free-scan quota
 * (`public-scan-quota.ts`) — both of which run on this exact path regardless of this flag.
 *
 * PRIVATE / installed-org scans are unaffected: they are walled by their own gate, which does not
 * consult this flag.
 */
export function publicScanSignInRequired(): boolean {
  return envBool("ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN");
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

/**
 * Whether the Registry tab's fixture-state PREVIEW switcher is offered.
 *
 * The switcher paints shaped example registries (`indexed`, `migrating`, `error`, …) over the tab so
 * the states a young org cannot yet produce can be seen. That is a development affordance: on a real
 * deployment an operator who lands on it sees a registry that is not theirs, stamped `preview` but
 * still occupying the tab — so it is opt-in via `ASCENT_REGISTRY_PREVIEW` and, like
 * `authBypassEnabled` / `creditGrantsEnabled`, HARD-DISABLED in production so a stray env var cannot
 * turn it on for customers.
 */
export function registryPreviewEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return envBool("ASCENT_REGISTRY_PREVIEW");
}
