> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)

# GitHub OAuth & Session — combined bug+ui scan

## 1. Proxy `getUser()` is un-guarded — a transient Supabase auth-server hiccup 500s every request
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: availability / error-handling
- **File**: src/proxy.ts:50
- **Scenario**: Supabase auth (the active login wall) is configured. The Supabase auth server has a brief network blip / 5xx / DNS hiccup. `await supabase.auth.getUser()` rejects. The proxy has no try/catch, so the rejection propagates and the proxy throws for **every** matched request (all pages and API routes per the broad `matcher`). The whole app returns 500 until Supabase recovers, even for routes that don't need a session (public scans, health-adjacent navigations, static-ish pages).
- **Root cause**: `access.ts#getViewer` deliberately wraps the identical `getUser()` call in try/catch ("A transient auth-server hiccup shouldn't hard-crash a render/handler — treat as signed-out"), but the proxy — which runs on a superset of requests and exists only to *refresh* cookies as a best-effort side effect — does not. The proxy treats a best-effort cookie refresh as request-fatal.
- **Impact**: Site-wide outage amplification: a partial/transient dependency failure in Supabase becomes a hard 500 on the entire surface, including unauthenticated paths that would otherwise work.
- **Fix sketch**: Wrap the `await supabase.auth.getUser()` in try/catch and on error `return response` (or `NextResponse.next({ request })`) so a refresh failure degrades to "cookie not refreshed this request" rather than a 500 — mirroring `getViewer`'s tolerance and the comment that authorization happens at the data sources anyway.

## 2. Supabase OAuth callback redirects via internal `url.origin`, not the external origin
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: oauth / proxy-origin
- **File**: src/app/auth/callback/route.ts:24,30
- **Scenario**: Deployed behind a TLS-terminating proxy (the exact topology the custom-OAuth helpers `publicOriginForRequest`/`secureCookieForRequest` were built to handle). After a successful Supabase code exchange the route does `NextResponse.redirect(new URL(next, url.origin))`, and on failure `new URL("/?auth_error=1", url.origin)`. `new URL(request.url).origin` is the **internal** origin (`http://internal-host:port`), so the post-login redirect can point the browser at the internal scheme/host instead of the public `https://app.example.com`.
- **Root cause**: This route reconstructs the redirect base from `url.origin` while the sibling custom-OAuth callback (`src/app/api/auth/callback/route.ts`) was explicitly migrated to `publicOriginForRequest(request)` for precisely this divergence. The two callbacks drifted: one is proxy-aware, the Supabase one is not.
- **Impact**: Behind a non-Host-preserving proxy the user is bounced to an internal/incorrect origin after GitHub sign-in (broken redirect, possible mixed-content/downgrade to http). On Host-preserving proxies / Vercel it happens to work, which is why it survives.
- **Fix sketch**: Build the redirect base from `publicOriginForRequest(request)` (already exported from `@/lib/auth`) instead of `url.origin`, single-sourcing the external-origin derivation with the custom flow.

## 3. Default sign-in CTA drives the dormant custom-OAuth button while Supabase is the active wall
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: auth-config / UX trust boundary
- **File**: src/components/SignInNotice.tsx:20
- **Scenario**: The manifest/design states Supabase GitHub OAuth is "the active login wall layered on top of a dormant custom GitHub OAuth." `SignInNotice` defaults `provider = "github"` (the dormant custom flow). Only `org/[slug]/layout.tsx` passes `provider="supabase"`; every other gated surface (`connect`, `usage`, `trends`, `report/compare`, `launch`, `invite`) renders the default GitHub button, which links to `/api/auth/login` (the custom OAuth round-trip). On a deployment where Supabase is the enforced wall but the custom OAuth env (`GITHUB_OAUTH_CLIENT_ID/SECRET`/`AUTH_SECRET`) is **not** configured, that button hits `isAuthConfigured()===false` and immediately redirects to `/connect?error=not_configured` — a dead-end sign-in affordance on most of the app.
- **Root cause**: The two auth systems gate independently (Supabase via `getViewer()`, custom via `getSessionState()`), but the shared CTA defaults to the dormant backend; the active backend was opted into in exactly one caller, so the default is wrong for a Supabase-primary deployment.
- **Impact**: Users on most gated pages get a sign-in button that either drives the wrong (dormant) flow or dead-ends with `error=not_configured`, depending on which OAuth env is present — a confusing/broken sign-in for the primary auth mode.
- **Fix sketch**: Default the provider from the active wall (e.g. `provider = authGateEnabled() ? "supabase" : "github"`, or pass it explicitly from each gated page), so the CTA always drives the backend that actually enforces the gate.

## 4. Silent-refresh re-mint omits the `Secure` flag fallback that login/callback rely on for production
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: cookie-security
- **File**: src/lib/auth.ts:284
- **Scenario**: A long-lived active user's cookie is re-minted on every silent refresh via `sessionCookieAttrs(await secureCookieForRequest())`. `secureCookieForRequest()` returns `true` in production unconditionally, else reads `x-forwarded-proto`. This is correct, but it depends entirely on the request carrying `x-forwarded-proto: https` outside production. On an HTTPS staging/preview build with `NODE_ENV !== "production"` behind a proxy that strips/omits `x-forwarded-proto`, the re-minted cookie is downgraded to non-Secure on the refresh path even though the *initial* callback cookie may have been Secure (set during the same kind of request). The mismatch is silent.
- **Root cause**: `Secure` is derived solely from a forwarded header that a misconfigured proxy can drop; there is no fallback to the cookie's own prior Secure state or to the request's actual TLS on the re-mint.
- **Impact**: On non-prod HTTPS deployments with an imperfect proxy, an actively-refreshing session cookie can be re-issued without `Secure`, exposing it to plaintext interception. Low because prod forces Secure and the common proxies forward the header.
- **Fix sketch**: Treat the re-mint Secure decision as "sticky" — never downgrade an existing Secure session cookie to non-Secure (e.g. read the inbound cookie's transport or default Secure on for any HTTPS request), or document that the proxy MUST forward `x-forwarded-proto`.

## 5. `GitHubSignInButton` keeps `cursor-wait`/disabled forever if the OAuth navigation never starts
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing-state / UX
- **File**: src/components/GitHubSignInButton.tsx:85
- **Scenario**: The button is an `<a href>` that sets `pending=true` on click and never resets it (intentionally, since a successful click navigates away). But if the navigation is cancelled — the user hits Esc/Back during the redirect, the browser blocks the navigation, or a slow `/api/auth/login` is aborted — the component is stuck showing the spinner, "Redirecting to GitHub…", `cursor-wait`, `opacity-70`, and `aria-disabled`, with all further clicks `preventDefault`-ed. The only recovery is a full page reload.
- **Root cause**: Pending state is one-way with no timeout/`pageshow`/`visibilitychange` reset, assuming the navigation always succeeds and unmounts the component.
- **Impact**: A user who interrupts the redirect is left with a permanently-dead sign-in button and no way to retry without reloading — a polish gap on the most conversion-sensitive control. (The Supabase button has the analogous shape but resets on `error`; the `<a>` variant has no error edge to reset on.)
- **Fix sketch**: Reset `pending` on `window` `pageshow`/`visibilitychange` (back-forward cache / tab return) or after a short safety timeout, so an aborted redirect re-enables the CTA.
