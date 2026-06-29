# GitHub OAuth & Session — Bug + UI Scan
> Context: GitHub OAuth & Session (Identity & GitHub Connectivity)
> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

This context is unusually well-hardened (HMAC sessions, constant-time CSRF compare, fail-open revocation, cookie-size trimming, an exhaustive test suite). The findings below are the genuine residue: a proxy-awareness gap in the *active* Supabase login that the rest of the module already defends against, plus a couple of reliability/maintainability items.

## 1. Supabase OAuth callback redirects to the INTERNAL origin behind a TLS-terminating proxy
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src/app/auth/callback/route.ts:16-30
- **Value**: impact 7 · effort 2 · risk 3
- **Scenario**: A user signs in via the active Supabase flow. Behind a non-Vercel TLS-terminating proxy, `new URL(request.url)` resolves to the *internal* http origin (this is the exact divergence the module documents and works around for the Secure flag and `redirect_uri` via `publicOriginForRequest`). The callback then does `NextResponse.redirect(new URL(next, url.origin))` (and `new URL("/?auth_error=1", url.origin)`), so the `Location` header points at e.g. `http://10.0.0.5:3000/...` — an address the browser can't reach. The session cookie is set, but the user lands on a connection error.
- **Root cause**: This callback (the active login path) was not migrated to the `publicOriginForRequest(request)` helper that the custom-OAuth login/callback use precisely to avoid the internal-origin trap; it still trusts `url.origin`. The custom callback (`src/app/api/auth/callback/route.ts:135`) builds its redirect with `request.url` and has the same latent gap, but it is the dormant flow.
- **Impact**: Broken core flow — sign-in "succeeds" yet the post-login landing is unreachable on affected deployments. (Some setups mask it via nginx `proxy_redirect` Location rewriting, but the module's own posture is to not rely on that.)
- **Fix sketch**: Resolve the redirect base from the external origin: `const base = publicOriginForRequest(request); NextResponse.redirect(new URL(next, base))`. Single-source it the same way the cookie-Secure and `redirect_uri` decisions already are.

## 2. CSRF same-origin guard compares browser Origin against the raw Host header, not the forwarded host
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/auth.ts:385-396
- **Value**: impact 5 · effort 2 · risk 3
- **Scenario**: `isSameOrigin` gates the logout and revoke-sessions POSTs via `new URL(origin).host === request.headers.get("host")`. Behind a proxy that rewrites `Host` to the internal upstream (the scenario the rest of the file defends against with `x-forwarded-host`), the browser's `Origin` is the external host while the received `Host` is internal → mismatch → a legitimate same-origin logout/revoke returns 403. The user cannot sign out / "sign out everywhere" via the button.
- **Root cause**: This check uses the raw `Host` header instead of the forwarded-host-aware host that `publicOriginForRequest` derives, so it diverges from the proxy model used everywhere else in the module.
- **Impact**: Degraded reliability of the session kill switches on Host-rewriting deployments; logout silently 403s. Cross-site requests still can't set `x-forwarded-host` (it's a proxy-controlled hop header), so honoring it does not weaken the guard.
- **Fix sketch**: Compare the Origin's host against the forwarded-aware host (reuse the host portion of `publicOriginForRequest(request)`), keeping the `Sec-Fetch-Site` fail-closed fallback.

## 3. SignOutButton ignores the signOut() result and can wedge — silent sign-out failure
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/SupabaseAuthButtons.tsx:78-85
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: `signOut()` does `await supabase.auth.signOut()` with no error inspection, then unconditionally `router.refresh()` + `router.push("/")`. If the call fails (network blip / auth-server hiccup) the cookies may not clear yet the UI navigates home as if signed out — success theater. On a shared machine the next person can still be authenticated. If the call *rejects*, the async handler throws, navigation never runs, and `pending` stays `true` forever (button stuck on "Signing out…"). Note the sibling `SupabaseSignInButton` (line 39) does check `error` — inconsistent.
- **Root cause**: No `{ error }` check and no `try/finally` to reset `pending`, unlike the sign-in button.
- **Impact**: User believes they signed out when they did not (security-adjacent confusion); or a permanently disabled button.
- **Fix sketch**: `const { error } = await supabase.auth.signOut();` — on error, surface it and reset `pending` in a `finally`; only navigate on success. Add `aria-busy`/`role=status` parity with the sign-in button while there.

## 4. Auth-gate composition is duplicated between access.ts and the proxy (drift hazard)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption
- **File**: src/proxy.ts:16-18
- **Value**: impact 4 · effort 2 · risk 2
- **Scenario**: `access.ts` defines `authGateEnabled()` = `supabaseAuthConfigured() && !authBypassEnabled()` (src/lib/auth gate, line 35-37). `proxy.ts` cannot import it (server-only), so it re-implements the same boolean as `gateInactive()` = `!(supabaseAuthConfigured() && !authBypassEnabled())`. The pure leaves already live in `@/lib/env`, but the *composition* is copied. If a future condition is added to `authGateEnabled` (e.g. a maintenance flag), the proxy's cookie-refresh decision silently diverges from the actual wall — exactly the class of bug the env.ts consolidation was meant to kill.
- **Root cause**: The composed predicate wasn't pushed down into the shared, next/headers-free `@/lib/env` alongside its two operands.
- **Impact**: Latent: the cookie-refresh surface and the enforcement gate can drift out of agreement after an unrelated edit.
- **Fix sketch**: Add `authGateEnabled()` to `@/lib/env` and have both `access.ts` (re-export) and `proxy.ts` (`gateInactive = !authGateEnabled()`) consume it — same pattern already applied to the two leaf predicates.

## 5. Sign-in button crossfade chrome is copy-pasted across the two sign-in buttons
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: component-extraction
- **File**: src/components/GitHubSignInButton.tsx:55-73
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: `GitHubSignInButton` (lines 55-73) and `SupabaseAuthButtons.tsx`'s `SupabaseSignInButton` (lines 58-69) contain byte-for-byte-similar markup: the icon/spinner crossfade `<span>` stack, the `focus-ring inline-flex … ${v.box}` class string, and the `role=status`/`aria-live` SR region. They already share `buttonChrome` for the atoms (GitHubMark, Spinner, variants) but not this assembled body, so a polish tweak (e.g. spinner timing, focus ring) must be made twice and can drift between the two visually-identical CTAs.
- **Root cause**: The shared affordance was abstracted at the atom level but the composed button body was duplicated when the Supabase variant was added.
- **Impact**: Maintenance/consistency risk; the two CTAs the user sees as "the same button" can silently diverge.
- **Fix sketch**: Extract a `SignInButtonChrome({ pending, idleLabel, busyLabel, variant })` presentational component (rendering the icon stack + label + SR status) and have both the `<a>` (GitHub) and `<button>` (Supabase) wrappers render it, keeping only the element/handler differences.
