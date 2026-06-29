# Biz+Bug Fix Wave 1 — Security & Access-Control

> 4 commits, 4 findings closed (1 Critical + 3 High). 1 High deferred-with-cause.
> Baseline preserved: tsc 0 → 0; vitest 2635 pass / 1 pre-existing env-fail → unchanged.

## Commits

| # | Commit | Finding | Sev | File |
|---|---|---|---|---|
| 1 | `3bdd15c` | `/api/app/repos` cross-tenant IDOR | **Critical** | `src/app/api/app/repos/route.ts` |
| 2 | `21ae1b8` | `/api/gate` `?ref` cache-bypass DoS | High | `src/app/api/gate/[owner]/[repo]/route.ts` |
| 3 | `5a0c0bd` | scan-completion open-relay email | High | `src/app/api/scan/stream/route.ts` |
| 4 | `a3d60bb` | `doctor.mjs --run` CI RCE warning | High | `src/lib/standard/doctor.ts` |

## What was fixed

1. **Cross-tenant IDOR (Critical).** `/api/app/repos` authorized only via `isAuthConfigured()` +
   `sessionHasInstallation()` — the *dormant* custom-OAuth path. Under the active Supabase login wall
   `isAuthConfigured()` is false, so the guard never fired and any caller could list a victim
   installation's **private** repos via `?org=`. Now, when `authGateEnabled()`, the route calls
   `requireOrgRead(org)` and **derives the installation from the authorized org** (ignoring a
   client-supplied `?installation_id=`, closing the "pair my org with a victim's installation" hole).
   Auth-off (local/demo) and the dormant custom-OAuth path are byte-for-byte unchanged. All real
   callers (connect / onboarding / fleet-map) already pass `?org=`.

2. **Gate `?ref` DoS (High).** The gate throttled only the LLM path (`?mock=0`); the default mock gate
   stayed unthrottled. But `?ref=<sha>` bypasses the per-commit cache, so spamming `?ref=<unique>`
   forced a fresh GitHub ingest on the shared `GITHUB_TOKEN` every call. Now rate-limited when
   `(!mock || ref)`; the cache-bounded no-ref mock gate stays unthrottled (the CI invariant is
   preserved — its test still passes).

3. **Open-relay email (High).** "Email me when done" fell back to a client-supplied `body.email`
   whenever a signed-in viewer had no account email, letting an authenticated user send Ascent-branded
   SES mail to an arbitrary recipient. Now a signed-in viewer is only ever mailed at their own verified
   address; the custom opt-in survives only on the (rate-limited) anonymous public funnel.

4. **`doctor.mjs --run` CI RCE (High).** The generated conformance script `execSync`s capability
   commands from `.ai/manifest.yaml`; wired into a fork-PR workflow with secrets it's arbitrary code
   execution + token exfiltration. Added a prominent SECURITY note to the generated script (run only on
   trusted code; never expose secrets to a fork-PR workflow that runs `--run`).

## Deferred (with cause)

- **Logo-URL SSRF / DNS-rebinding (High, `src/lib/db/branding.ts:34`).** Already string-guarded by the
  shared `isSafePublicHttpsUrl` (rejects loopback/private/CGNAT/link-local/internal hostnames). The
  residual — a hostname that *resolves* to a private IP at fetch time — is explicitly documented in-code
  as needing a resolve-and-pin at the fetch site, which `@react-pdf` owns. A string-level re-check can't
  close it (TOCTOU); a proper fix is a pinned-IP image fetch. Left as the documented follow-up.

## Patterns established (catalogue items 1–3)

1. **Dual-auth-layer gate drift** — when an app layers a new auth wall (Supabase) over a dormant one
   (custom OAuth), every gate must branch on the ACTIVE wall first. A route that checks only the dormant
   predicate (`isAuthConfigured()`) is silently open in prod. Grep for `isAuthConfigured()` used without
   an adjacent `authGateEnabled()` branch.
2. **Cache-bypass amplification** — a `?ref=`/`?nonce=` param that bypasses a cache turns a cheap cached
   endpoint into an unbounded per-call cost. Rate-limit the bypass path even when the cached path is left
   open for legitimate (CI/crawler) traffic.
3. **Identity-fallback recipient** — `trustedIdentity ?? clientSuppliedValue` for an outbound side effect
   (email/SMS/webhook) is an impersonation/relay vector when the trusted value is absent. Only honor the
   client value when there is provably no identity at all (anonymous), and rate-limit it.

## What remains

Wave 2 (billing/quota integrity), Wave 3 (slug canonicalization), Wave 4 (DSQL read resilience),
Wave 5 (silent failures / report data-integrity), Wave 6 (races/stale-data), Wave 7+ (edge/validation
tail). Business track (90) is a separate curated backlog.
