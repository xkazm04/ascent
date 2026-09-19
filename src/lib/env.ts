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
/**
 * Whether the operator EXPLICITLY declared this a self-hosted deployment (`ASCENT_SELF_HOSTED=1`),
 * as opposed to `selfHosted()`'s implicit no-billing default. The distinction gates surfaces that
 * should not appear just because Polar happens to be unconfigured: the Admin → Pairing tab maps
 * repos to the server's filesystem, and showing it to every billing-less dev deployment put a
 * filesystem-shaped control in front of people who never opted into local mode. Feature BEHAVIOR
 * (gates, metering) stays on `selfHosted()`; only deliberate local-mode UI keys on this.
 */
export function selfHostedExplicit(): boolean {
  const raw = process.env.ASCENT_SELF_HOSTED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** Warn-once latch for the production fall-through below. Module-scoped so the log fires once per
 *  process, not once per gate check — `selfHosted()` is consulted on nearly every plan decision. */
let inferredSelfHostWarned = false;

export function selfHosted(): boolean {
  const raw = process.env.ASCENT_SELF_HOSTED?.trim().toLowerCase();
  // Deliberately NOT envBool: this flag needs a third state. `envBool` cannot distinguish "unset"
  // (fall through to the billing sniff) from an explicit "0" (the operator says: enforce plans).
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  const inferred = !billingConfigured();
  // The inference is right for a fresh clone and wrong for a managed deployment that has LOST its
  // Polar token: every plan gate opens, scans stop metering, and nothing says so. The mode is still
  // inferred (changing that would break existing self-hosts that never set the flag) — but in
  // production it no longer happens silently. Server-side only: `@/lib/plans` is imported by client
  // components for its DATA constants, and this must not log in a browser console.
  if (inferred && !inferredSelfHostWarned && typeof window === "undefined" && process.env.NODE_ENV === "production") {
    inferredSelfHostWarned = true;
    console.warn(
      "[env] ASCENT_SELF_HOSTED is unset and POLAR_ACCESS_TOKEN is absent — this production deployment " +
        "is running SELF-HOSTED: every plan gate is open, scans are unmetered, retention is unbounded. " +
        "Set ASCENT_SELF_HOSTED=1 to declare that deliberate, or ASCENT_SELF_HOSTED=0 to enforce plans.",
    );
  }
  return inferred;
}

/** Test seam: reset the warn-once latch. Not used in production code. */
export function __resetSelfHostWarning(): void {
  inferredSelfHostWarned = false;
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
 * `401 {"code":"auth_required"}` — while everything READ-ONLY stayed open (saved report 200, gate
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

// ── Proxy-trust predicate ────────────────────────────────────────────────────

/** Warn-once latch for the unwitnessed proxy-trust default below. Module-scoped so the log fires
 *  once per process, not once per request — `trustedProxyHops()` is on the limiter's hot path. */
let unwitnessedProxyTrustWarned = false;

/**
 * TRUST MODEL (quotas-rate-limiting 07-16 #1): how many proxies between the client and this app are
 * trusted to append honest forwarding headers, from `ASCENT_TRUSTED_PROXY_HOPS`. Consumed by
 * `clientIp` (src/lib/rate-limit.ts), which is the ONLY reader — the raw env var is never read at a
 * call site, so the default and its warning cannot be lost by someone re-deriving the value.
 *
 *   - `0` — NO proxy is trusted (e.g. a self-hosted node behind a proxy that forwards client headers
 *     VERBATIM, or with the app port reachable directly, where an attacker can mint a fresh
 *     `x-real-ip` per request and bypass every per-IP limit AND the 30-day quota). All forwarding
 *     headers are ignored; every anonymous caller shares one burst bucket (fail closed) and the
 *     monthly quota treats the caller as unidentifiable (fail open — see public-scan-quota's
 *     bucketContext) instead of trusting spoofable input.
 *   - `1` (default) — platform mode: `x-real-ip` first, then the RIGHT-most XFF hop.
 *   - `N >= 2` — an N-hop trusted chain (e.g. CDN → LB → app): the client is the Nth-from-the-right
 *     XFF entry (the right-most N−1 are the trusted proxies' own addresses — bucketing on those would
 *     collapse thousands of real users into a handful of edge IPs and lock the whole anonymous funnel
 *     out of the 30-day quota). `x-real-ip` is NOT trusted here: it was set by an intermediate hop and
 *     names the wrong peer. A chain shorter than N yields "unknown" (fail closed / unidentifiable).
 *
 * Anything else (unset, non-integer, negative) → 1.
 *
 * THE FAIL-OPEN, MADE LOUD. The default of 1 means an UNCONFIGURED deployment trusts `x-real-ip`
 * verbatim, with no platform signal and no peer check behind it. That default is still right — every
 * managed platform sets that header, and flipping the default to 0 would drop every self-hosted
 * deployment behind an honest proxy into one shared fail-closed bucket, breaking the anonymous funnel
 * for real users to defend against a shape the operator may not have. So, like `selfHosted()`'s
 * production inference, the fall-through is not forbidden — it is made LOUD: when the operator has
 * neither set the var NOR is running somewhere that witnesses the proxy (Vercel), say so once.
 */
export function trustedProxyHops(): number {
  const raw = process.env.ASCENT_TRUSTED_PROXY_HOPS?.trim();
  if (!raw) {
    // No declaration. A platform whose edge OWNS the forwarding headers is a witness that trusting
    // one hop is correct; without one, the value is an assumption nobody has confirmed.
    const witnessed = Boolean(process.env.VERCEL);
    if (!witnessed && !unwitnessedProxyTrustWarned && typeof window === "undefined") {
      unwitnessedProxyTrustWarned = true;
      console.warn(
        "[env] ASCENT_TRUSTED_PROXY_HOPS is unset and no platform proxy witness was found — " +
          "`x-real-ip` is trusted without a witness, so if this app is reachable without a trusted " +
          "proxy a caller can mint a fresh rate-limit bucket AND a fresh monthly-quota bucket per " +
          "request by setting that header. Set ASCENT_TRUSTED_PROXY_HOPS=0 if the app is reachable " +
          "without a trusted proxy, or 1/N to declare the proxy chain.",
      );
    }
    return 1;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** Test seam: reset the unwitnessed-proxy-trust warn-once latch. Not used in production code. */
export function __resetTrustedProxyWarning(): void {
  unwitnessedProxyTrustWarned = false;
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
