# Bug Hunter Scan — GitHub OAuth & Session (ascent)

> Total: 7 findings (Critical: 0 | High: 2 | Medium: 3 | Low: 2)

## 1. Callback ignores GitHub's `error` params — denied/expired auth shows a generic, unactionable failure and races the state check
- **Severity**: High
- **Category**: recovery-gap
- **File**: src/app/api/auth/callback/route.ts:34-47
- **Scenario**: If a user clicks "Cancel" on GitHub's consent screen (or the authorization expires / the App is suspended), GitHub redirects back to `/api/auth/callback?error=access_denied&error_description=...&state=<state>` with **no `code`**. The handler never reads `error`/`error_description`; it only checks `!code`, so the user is bounced to `/connect?error=oauth` — the exact same generic message produced by a forged/mismatched CSRF state.
- **Root cause**: The OAuth callback contract has two distinct failure shapes — (a) GitHub returned an `error` param (user/GitHub-side denial) and (b) the request is missing/forged (`code`/`state` absent or mismatched). The code collapses both into one branch and surfaces neither GitHub's reason nor a distinct CSRF-failure signal.
- **Impact**: UX (a user who simply mis-clicked sees an opaque "oauth" error with no "you cancelled / try again" guidance); also makes real CSRF-state mismatches indistinguishable from benign denials in logs, blinding incident response. Note the GitHub error arrives *with* a valid `state` cookie still set, so the state check passes and the only thing that catches it is the `!code` guard.
- **Fix sketch**: Read `url.searchParams.get("error")` first; if present, redirect to a distinct `/connect?error=denied` (mapping known codes like `access_denied`) and log `error_description`. Keep the CSRF-mismatch branch separate (`error=csrf`) from the missing-code branch so logs and UX diverge.

## 2. Silent-refresh cookie re-mint failure is swallowed, indefinitely freezing a near-expired access window in DB mode
- **Severity**: High
- **Category**: silent-failure
- **File**: src/lib/auth.ts:251-259
- **Scenario**: `getSessionState` runs during many Server Component renders where the cookie store is read-only. When the access token is inside the renew window, it builds `renewed` and calls `store.set(...)`, which **throws** during a render; the `catch {}` swallows it and the function falls through to `return { session, status: "active" }` with the *original, un-renewed* token. If the user only ever hits server-component pages (never a Route Handler / Server Action that can mutate cookies) for the ~30 min between `exp - ACCESS_RENEW_WITHIN_MS` and `exp`, the cookie is never re-minted. Once `now >= session.exp` and the DB is the authority, the very next resolve that *also* can't reach `verdict === "valid"` (or any read-only render past `exp`) trips line 242 and returns `expired`.
- **Root cause**: The re-mint is best-effort by design, but the design assumes "the cookie refreshes on the next *mutable* request" — there is no guarantee such a request occurs before the short access `exp` lapses. An app surface that is read-mostly (dashboards rendered as Server Components) can starve the refresh and abruptly expire an actively-browsing user.
- **Impact**: UX / session integrity — an active user is unexpectedly logged out mid-session (the "expired" prompt) despite continuous activity, the exact outcome the sliding window was built to prevent. Hard to reproduce/diagnose because the failing `store.set` is silent.
- **Fix sketch**: Don't rely solely on opportunistic re-mint. Either (a) when `now >= session.exp - RENEW` and the cookie can't be written, still return `active` but flag `needsRefresh` so a thin middleware / Route Handler re-mints on the next request; or (b) widen `ACCESS_RENEW_WITHIN_MS` relative to typical render-only dwell time; and at minimum log when the re-mint is skipped so the starvation is observable.

## 3. Login route sets STATE/NEXT/RESYNC cookies WITHOUT `Secure` behind a TLS-terminating proxy
- **Severity**: Medium
- **Category**: cookie-flags
- **File**: src/app/api/auth/login/route.ts:21-28
- **Scenario**: If the app runs behind a TLS-terminating proxy/load balancer (the deployment the callback's own comment at callback/route.ts:91-94 explicitly calls out), `url.origin` is the *internal* `http://...` origin, so `origin.startsWith("https")` is `false`. The login route then mints `ascent_oauth_state`, `ascent_oauth_next`, and `ascent_oauth_resync` with `secure: false`, even though the browser-facing connection is HTTPS.
- **Root cause**: The session cookie was fixed to derive `Secure` from `x-forwarded-proto` via `secureCookieForRequest()`, but the OAuth *state* cookie — the one whose confidentiality the CSRF defense depends on — was left on the old, proxy-blind `origin.startsWith("https")` heuristic. The two paths drifted.
- **Impact**: session/CSRF integrity — the CSRF `state` cookie (and the `next` redirect target) can be transmitted over plaintext on the first request that doesn't go through TLS to the app process, and is exposed to a network attacker who can then forge a matching `state` in a CSRF login-attack. Lower than session-hijack because the window is one short-lived round-trip, but it's the security-critical cookie.
- **Fix sketch**: Use `await secureCookieForRequest()` for the STATE/NEXT/RESYNC cookies in the login route too, exactly as the callback does for the session cookie. Single-source the secure decision.

## 4. `RESYNC_COOKIE` cleared without matching `secure`/`path` attributes — stale "resync" flag can survive
- **Severity**: Medium
- **Category**: session-integrity
- **File**: src/app/api/auth/login/route.ts:29 / src/app/api/auth/callback/route.ts:99-101
- **Scenario**: Cookie deletion only matches a cookie whose `name`+`path` (and, for `__Secure`-style handling, attributes) align. The login route sets RESYNC with `secure` possibly `true` (direct HTTPS) on one visit; a later abandoned-flow `res.cookies.delete(RESYNC_COOKIE)` (login route line 29) and the callback's `res.cookies.delete(RESYNC_COOKIE)` rely on Next's default delete attributes. If a prior RESYNC was set with `path:"/"` + `secure:true` and a subsequent delete is emitted in a context computing `secure:false`, the browser may retain the original cookie. A leftover `resync=1` then makes the *next fresh* sign-in take the resync branch (skip `/launch`, append `resynced=1`) — precisely the failure the line-26 comment says it's guarding against.
- **Root cause**: Set and delete don't go through a shared attribute helper, so the delete's implicit attributes can fail to match the set's explicit `{ secure, path }`.
- **Impact**: UX / state corruption — onboarding cinematic skipped on a genuine first sign-in, or a "re-synced" confirmation shown on a flow that wasn't a resync. Not a security breach, but a real cross-flow state-leak.
- **Fix sketch**: Delete with the same `path` (and `secure`) the cookie was set with, e.g. `res.cookies.set(RESYNC_COOKIE, "", { path: "/", secure, maxAge: 0 })`, via one shared helper used by both set and clear.

## 5. CSRF `state` is compared with a non-constant-time `!==`, leaking via timing; and is not bound to the user/session
- **Severity**: Medium
- **Category**: csrf-state
- **File**: src/app/api/auth/callback/route.ts:45
- **Scenario**: The callback validates CSRF with `state !== savedState` (a plain string compare), unlike the session HMAC which correctly uses `timingSafeEqual`. The `state` is also a bare random value with no binding to anything the attacker can't also obtain — it's only "does the cookie value echo the query value." A login-CSRF attacker who can seed both the victim's `state` cookie and the matching `state` query param (e.g. via the Secure-flag gap in finding #3, or any path that lets them set the short-lived cookie) passes this check.
- **Root cause**: The state check is treated as a cheap equality rather than a security comparison, and the design assumes the `state` cookie is unforgeable/confidential — an assumption that the plaintext-cookie path (#3) weakens.
- **Impact**: CSRF / session-fixation-adjacent. The timing leak alone is low (random 128-bit value), but combined with the cookie-confidentiality gap it raises login-CSRF feasibility. Primarily flagged for defense-in-depth on the one comparison that gates the whole OAuth handshake.
- **Fix sketch**: Compare with `timingSafeEqual` over equal-length buffers (guarding length first), mirroring `decodeSession`. Optionally bind `state` into the signed flow (e.g. HMAC the state with `AUTH_SECRET`) so a leaked cookie value alone isn't sufficient.

## 6. Resync redirect mangles `next` targets that carry a fragment or existing query — `resynced=1` lands in the wrong place
- **Severity**: Low
- **Category**: edge-case
- **File**: src/app/api/auth/callback/route.ts:84-86
- **Scenario**: `safeNext` deliberately preserves `url.hash`, so `next` can be `/connect#section` or `/connect?tab=x#frag`. The resync branch builds `${next}${next.includes("?") ? "&" : "?"}resynced=1`. For `/connect#section` → `/connect#section?resynced=1` (the `?resynced=1` becomes part of the fragment; the page never sees a `resynced` query param). For `/connect?tab=x#frag` → `/connect?tab=x#frag&resynced=1` (appended *after* the fragment — broken). The "re-synced" confirmation the resync flow exists to show silently never appears.
- **Root cause**: Query-param concatenation by naive string ops, ignoring that the validated `next` may contain a `#` fragment (and that the fragment must stay last).
- **Impact**: UX — the post-resync confirmation flag is lost for any `next` containing a fragment, so the user gets no "access re-synced" feedback.
- **Fix sketch**: Construct via `URL`: `const u = new URL(next, request.url); u.searchParams.set("resynced", "1"); const dest = u.pathname + u.search + u.hash;` so the param is placed correctly regardless of existing query/fragment.

## 7. `exchangeCodeForToken` discards GitHub's `error_description` and treats a 200-with-error as a hard failure with no retry
- **Severity**: Low
- **Category**: silent-failure
- **File**: src/lib/auth.ts:401-416
- **Scenario**: GitHub's token endpoint returns HTTP 200 even on failure, with a JSON `{ error, error_description }`. On an expired/already-used `code` (e.g. the user double-submits the callback, or a prefetcher replays it), GitHub returns `{ error: "bad_verification_code" }`. The code throws `OAuth token exchange failed: bad_verification_code`, which the callback's outer `catch` flattens to `error=oauth_failed`. `error_description` (the human-readable reason) is dropped, and a transient `slow_down`/`rate_limit`-style response is not retried the way the `gh()` calls are via `withGithubRetry`.
- **Root cause**: The token-exchange path predates / sidesteps the `withGithubRetry` + `GitHubError` machinery used for the API calls, and only inspects `error` (not `error_description`), so transient vs. permanent token-exchange failures are indistinguishable and unretried.
- **Impact**: UX / observability — a one-off replayed or double-submitted callback (common with link prefetchers) yields a generic failure with no log of *why*, and a transient exchange blip isn't retried. Low because the user can simply re-initiate sign-in.
- **Fix sketch**: Include `data.error_description` in the thrown message/log; detect a non-OK HTTP status separately; and consider routing token exchange through the same bounded-retry helper for transient (`429`/`5xx`) responses.
