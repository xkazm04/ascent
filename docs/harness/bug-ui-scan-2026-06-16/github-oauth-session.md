# GitHub OAuth & Session — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 4 / ui-perfectionist 1
> Files read: 15

## 1. Dev auth-bypass has no production guard — a single stray env var disables the entire login wall
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: auth / dev-bypass leaking into prod (privileged surface)
- **File**: src/lib/access.ts:25 (also src/proxy.ts:17)
- **Scenario**: `ASCENT_AUTH_BYPASS=1` (or `true`) is set in a production environment — copied from a `.env.example`, inherited from a shared CI/preview config, or fat-fingered in the dashboard. Every gate now passes and `getViewer()` returns the synthetic `DEV_VIEWER` ("developer") for all requests; the proxy (`gateInactive()` true) also stops refreshing/touching Supabase entirely.
- **Root cause**: `authBypassEnabled()` keys solely off the env var with no `NODE_ENV`/`VERCEL_ENV` fence. The bypass is a hard OR over the gate (`authGateEnabled = supabaseAuthConfigured() && !authBypassEnabled()`) and `getViewer` checks the bypass *before* Supabase, so there is zero defense-in-depth: the flag's presence alone fully opens the app. The same unfenced check is duplicated in `proxy.ts:17`, so a prod misconfig also silently kills cookie refresh.
- **Impact**: Total auth disablement and impersonation of a privileged synthetic viewer from one misconfigured variable — the highest-blast-radius failure mode on this surface, and exactly the "dev bypass leaking into prod" risk this gate is supposed to resist.
- **Fix sketch**: Refuse the bypass in production: `return process.env.NODE_ENV !== "production" && (v === "1" || v === "true")`. If a prod bypass is ever legitimately needed (e.g. a demo deploy), require an explicit second signal (a dedicated `ASCENT_DEMO_MODE`) and log loudly at boot. Single-source the check (export it from `access.ts`) so `proxy.ts` can't drift.

## 2. Supabase OAuth callback redirects against the internal `url.origin`, not the public origin
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: OAuth callback / proxy-aware origin handling
- **File**: src/app/auth/callback/route.ts:24 (and :30)
- **Scenario**: Behind a TLS-terminating proxy/load balancer (the deployment topology the rest of this module bends over backwards to support), a user finishes Supabase GitHub login. The post-login redirect is built as `new URL(next, url.origin)` where `url = new URL(request.url)` — the *internal* origin (`http://`, internal host), not the browser-facing one.
- **Root cause**: This file constructs its redirect base from raw `url.origin`, whereas the entire custom-OAuth flow was deliberately rebuilt to use `publicOriginForRequest(request)` / `request.url` precisely because `url.origin` is the internal origin behind a proxy (see the long comments in `login/route.ts:24-28`, `auth.ts:189-208`, and the custom `callback/route.ts:135` which uses `new URL(dest, request.url)`). This sibling callback never got the same treatment. (Note: `safeNext` keeps it from being an open-redirect, but the base origin is still wrong.)
- **Impact**: The user can be bounced to an `http://` internal hostname after sign-in — a broken/insecure landing (downgrade to plaintext, or an unreachable internal host), and a silent inconsistency with the custom flow that makes this path behave differently under the same proxy. Lower than an open redirect, but a real correctness/consistency bug on a security-adjacent path.
- **Fix sketch**: Redirect against the public origin: reuse `publicOriginForRequest(request)` (or build the absolute URL from `request.url`, matching `callback/route.ts:135`) for both the success and `auth_error` redirects so all callbacks single-source their external origin.

## 3. `requireViewer` returns 401 JSON for unauthenticated browser navigations, never a sign-in redirect
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent auth failure / session-expiry UX on protected routes
- **File**: src/lib/access.ts:85
- **Scenario**: A viewer's Supabase session lapses (or they were never signed in) and they hit a gated API route, or a route handler that streams to a page. `requireViewer()` returns `NextResponse.json({ error: "Sign in to continue." }, { status: 401 })`. For an XHR/fetch caller this is fine, but for any handler reached by top-level navigation or `<form>` post the user sees a raw JSON 401 with no path back to login — the opposite of the friendly "your session expired" prompt `SignInNotice` was built to show.
- **Root cause**: The gate has a single unauthenticated response shape (JSON 401) and no notion of "this is a navigable request that should be redirected to sign-in." There is no `Sec-Fetch-Mode: navigate` / `Accept: text/html` branch, and no shared helper to bounce to the sign-in page with `next`.
- **Impact**: Dead-end UX on session expiry for any navigable gated route; users are stranded on a JSON blob rather than being routed to re-authenticate. Functional, not exploitable.
- **Fix sketch**: In `requireViewer`, when the request looks navigable (`Sec-Fetch-Mode: navigate` or `Accept` includes `text/html`), redirect to the sign-in page with `?next=` (run through `safeNext`) instead of returning JSON; keep the 401 for API/fetch callers.

## 4. Logout/revoke same-origin guard falls fully open when both Origin and Sec-Fetch-Site are absent
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: CSRF guard robustness
- **File**: src/lib/auth.ts:381 (`isSameOrigin`), used by logout/route.ts:23 and revoke-sessions/route.ts:19
- **Scenario**: A cross-site POST that arrives with neither an `Origin` header nor `Sec-Fetch-Site` (e.g. a navigation-initiated submission from a client that strips/omits both, or a non-conforming agent) reaches `/api/auth/logout` or `/api/auth/revoke-sessions`. `isSameOrigin` reaches its final `return request.headers.get("sec-fetch-site") === "same-origin"`, which is `null === "same-origin"` → `false`, so it is *denied* — good. But the inverse gap is the concern: the guard trusts `Origin`'s host equality without also confirming the request isn't a missing-`Host` edge, and has no fallback assertion that at least one trustworthy signal was present.
- **Root cause**: The guard is a best-effort OR of two optional signals; it correctly denies when both are missing (verified by reading the branch), so the practical risk is low. The residual issue is that it relies on modern fetch-metadata being present and has no explicit "neither signal present ⇒ reject and log" path, making the security posture implicit rather than asserted.
- **Impact**: Low in practice (current logic denies the both-missing case), but the implicit reliance on header presence is fragile and worth hardening so a future refactor can't accidentally invert it. Logout CSRF is also self-limiting (annoyance, not escalation).
- **Fix sketch**: Make the deny-by-default explicit: require a positive same-origin signal (Origin host match OR `Sec-Fetch-Site: same-origin`) and otherwise reject with a logged warning, so the "no signal" outcome is intentional and refactor-safe.

## 5. Supabase sign-in failure is swallowed to the console — the user clicks and nothing visibly happens
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: error messaging / loading-state on sign-in CTA
- **File**: src/components/SupabaseAuthButtons.tsx:72-77 (`SupabaseSignInButton.signIn`)
- **Scenario**: `supabase.auth.signInWithOAuth(...)` returns an `error` (misconfigured project URL/anon key, network blip, blocked third-party context). The handler logs to `console.error`, flips `pending` back to false, and returns — the button silently resets to its idle "Sign in with GitHub" state with no on-screen feedback. To the user the primary login CTA simply does nothing; they click again into the same failure.
- **Root cause**: There is no error state rendered. Unlike the redirect-failure path that at least logs, nothing is surfaced in the UI — no `role="alert"`, no inline message, no toast. The component is also the one CTA that *can* fail client-side (the custom `GitHubSignInButton` is a plain `<a>` that just navigates), so it most needs an error affordance and is the one that lacks it.
- **Impact**: A broken or dead-end primary sign-in experience on the actual active login wall (Supabase is the enforced backend). On the highest-stakes conversion step, a recoverable failure looks like a frozen button — directly costing sign-ins and trust.
- **Fix sketch**: Add an `error` state (`useState<string|null>`) set on the failure branch and render it in a `role="alert"` region near the button (mirroring `SignInNotice`'s amber `alert` slot), with retry guidance. Wrap the call in try/catch so a thrown rejection (not just a returned `error`) is also surfaced rather than leaving `pending` stuck true.
