# Bug Hunter — GitHub OAuth & Session (ascent)

> Total: 6 findings (Critical: 0, High: 2, Medium: 2, Low: 2)
> Files read: 9
> Scope: /api/auth/(login|callback|logout), lib/auth, SignInNotice

Overall this is an unusually well-defended auth surface: login has a real CSRF `state`
(128-bit, `httpOnly`+`SameSite=Lax`), the session is HMAC-signed, `safeNext` resists every
open-redirect payload I threw at it (`//host`, `/\host`, absolute URLs, `/..//host`,
encoded `%2F%2F` stays in-path), cookies are `httpOnly`, logout is POST-only with a
same-origin check plus server-side revocation, and token-exchange failures surface as
`error=oauth_failed` rather than a half-authenticated state. The findings below are the
residual gaps.

## 1. Initial session cookie can be minted without `Secure` behind a TLS-terminating proxy
- **Severity**: High
- **Category**: code_quality
- **File**: src/app/api/auth/callback/route.ts:90 (and login/route.ts:21); contrast src/lib/auth.ts:170-178 (`secureCookieForRequest`)
- **Scenario**: App is deployed behind a proxy/load balancer that terminates TLS and forwards plain `http://` internally (a very common topology). The callback computes `secure: origin.startsWith("https")` from `new URL(request.url)` — which reflects the *internal* `http` origin — so the `ascent_session` Set-Cookie is emitted **without** the `Secure` attribute. The browser will then send the session cookie over any future plaintext request to the host.
- **Root cause**: The initial mint (login state cookie + callback session cookie) derives `secure` from the request-URL origin, while the silent-refresh path uses `secureCookieForRequest()` which consults `x-forwarded-proto` AND forces `Secure` when `NODE_ENV==="production"`. The two code paths disagree, and only the refresh path is hardened. So a session is minted insecurely but later "upgraded" to Secure on refresh — inconsistent and easy to miss.
- **Impact**: session cookie disclosure over plaintext / session hijacking on misconfigured (but standard) reverse-proxy deployments.
- **Fix sketch**: Single-source the `secure` decision through one helper that honors `x-forwarded-proto` and the `NODE_ENV==="production"` backstop, and use it in login + callback as well as refresh.

## 2. Logout / revocation silently does not take effect when the revocation DB is unavailable
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/auth.ts:187-199 (`verifySessionVersion` fail-open) + :242 (TTL guard); src/app/api/auth/logout/route.ts:29-35
- **Scenario**: User clicks "Log out" (or "sign out everywhere"). `bumpSessionVersion` succeeds and the local cookie is deleted, so the user *believes* every copy of the token is dead. A stolen/leaked copy of that same cookie is then replayed while the Postgres/revocation store is briefly unavailable (deploy, failover, connection-pool exhaustion). `verifySessionVersion` catches the error and returns `unknown`; because the access `exp` is still in the future, line 242 lets the request through — the "revoked" token keeps working for up to the full 60-minute access TTL.
- **Root cause**: Revocation enforcement fails OPEN on DB error. This is documented as deliberate ("don't log everyone out on a hiccup"), but it quietly converts logout from "immediate" to "eventually, within 60 min, if the DB is up at check time" — exactly during the window an attacker controls (they can retry until they hit a DB blip).
- **Impact**: silent failure of logout under DB outage — a revoked/leaked session survives up to ACCESS_TTL_MS. Account-access window after explicit revocation.
- **Fix sketch**: For the *revoked-suspected* path specifically, treat `unknown` as deny once a cookie is past a short grace window, or shorten ACCESS_TTL when the store is unreachable; at minimum surface to the user that "sign out everywhere" only fully applied if the store was reachable.

## 3. `verifySessionVersion` cannot distinguish a never-revoked login from a wiped revocation table
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/auth.ts:190-191; src/lib/db/sessions.ts:17-24 (`getSessionVersion` returns 0 for a missing row)
- **Scenario**: All sessions for a login were revoked (stored version = 5). The `sessionRevocation` table is later restored from a backup taken before those revocations, truncated, or the row is deleted (manual cleanup / migration). `getSessionVersion` now returns 0 for that login. A still-held cookie minted at `sv: 3` (or any value) compares `stored(0) > sv(3)` → false → verdict `valid`, so previously-revoked sessions become live again and even get silently re-minted with a fresh TTL.
- **Root cause**: Revocation is modeled as a monotonically increasing counter whose ground truth is "0 when absent." Any loss/reset of the row reads as "never revoked," and version numbers only ever move forward in the cookie, so the comparison can never catch a regressed store.
- **Impact**: session resurrection — explicitly revoked sessions silently regain access after a revocation-table reset/restore. Hard to notice.
- **Fix sketch**: Treat an absent row as "no authority" the same as a DB error for a cookie carrying `sv > 0`, or persist revocation rows durably and never reset them; alternatively bind the cookie to a per-login secret that rotates on revoke.

## 4. Concurrent / re-issued logins do not invalidate the prior session (no session rotation)
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/auth/callback/route.ts:63-77 (sv read, not bumped); src/lib/auth.ts:507-547 (`buildSession`)
- **Scenario**: A user's session cookie is captured (XSS-adjacent leak, shared machine, malware). The user later re-authenticates via GitHub from a clean device, expecting a fresh login to "reset" their account. The callback only *reads* `getSessionVersion(user.login)` and stamps the new cookie with the same `sv`; it never bumps the version. The previously captured cookie therefore remains fully valid — a new login does not rotate or invalidate older sessions.
- **Root cause**: Session version is only advanced by explicit logout / `revokeOtherSessions`, never by the login flow itself, so signing in again is purely additive. There is no session-fixation/rotation step at authentication time.
- **Impact**: a fresh sign-in gives no protection against an already-leaked older session (session fixation / stale-session persistence). Users reasonably assume re-login is a security reset; it isn't.
- **Fix sketch**: Optionally bump the session version on each interactive login (callback) so re-authenticating invalidates prior tokens, or offer it as a "sign out other sessions on login" toggle.

## 5. No floor on `AUTH_SECRET` strength — a weak secret makes every session forgeable
- **Severity**: Low
- **Category**: code_quality
- **File**: src/lib/auth.ts:83-93 (`isAuthConfigured` only checks truthiness; `hmac` uses the secret as-is)
- **Scenario**: An operator sets `AUTH_SECRET=secret` (or any short/low-entropy value) to "just get auth working." `isAuthConfigured()` returns true on any non-empty string, and `hmac` signs every session with that key. An attacker who guesses/brute-forces the HMAC key can forge a session cookie for *any* GitHub login (e.g. `{login:"victim-org-owner", installations:[...]}`) and gain that org's access, since authorization is derived entirely from the signed cookie (`readableOrgForOwner`, `requireOrgAccess`).
- **Root cause**: The signing key's quality is taken on faith. The whole auth/authorization model hinges on HMAC unforgeability, but nothing enforces adequate key length/entropy, and the `?? ""` fallback in `hmac` would silently sign with an empty key if the env var were ever cleared after the configured check.
- **Impact**: account/org takeover via forged session if a weak secret is used — but requires operator misconfiguration, hence Low.
- **Fix sketch**: In `isAuthConfigured` (or a boot check) require `AUTH_SECRET.length >= 32` and fail closed/loudly otherwise; never fall back to `""` in `hmac`.

## 6. Re-sync confirmation flag is lost when `next` carries a URL fragment
- **Severity**: Low
- **Category**: functionality
- **File**: src/app/api/auth/callback/route.ts:83-85
- **Scenario**: A "re-sync access" round-trip is started from a page whose `next` includes a fragment, e.g. `/connect#installations`. `safeNext` legitimately preserves the hash, so the callback builds `dest = "/connect#installations" + "?resynced=1"` → `/connect#installations?resynced=1`. The `?resynced=1` now lives *inside the fragment*, so it is never parsed as a query param. The connect page reads `resynced` from `searchParams` (server-side) and shows nothing — the user gets no "re-synced" confirmation.
- **Root cause**: The flag is appended with a naive `includes("?") ? "&" : "?"` string concat that assumes `next` is `path[?query]`, ignoring that `safeNext` can legitimately return a `#fragment`. Appending a query after a fragment is malformed.
- **Impact**: UX — silent loss of the re-sync confirmation banner for fragment-bearing destinations. No security impact.
- **Fix sketch**: Build the destination with the `URL` API (set `searchParams`) instead of string concatenation so the query is always placed before any fragment.
