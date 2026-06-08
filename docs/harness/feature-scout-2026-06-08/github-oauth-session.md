# Feature Scout — GitHub OAuth & Session

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Active-session log-out / device management ("sign out everywhere")
- **Severity**: High
- **Category**: feature
- **File**: src/app/api/auth/logout/route.ts:37 (new sibling route, e.g. `POST /api/auth/sessions/revoke-all`)
- **Gap**: The revocation primitives already exist — `bumpSessionVersion(login)` invalidates *every* outstanding token for a login on its next resolve (src/lib/db/sessions.ts:31, src/lib/auth.ts:187 `verifySessionVersion`). But the only thing that calls it is logout (one browser) and `removeInstallation`. There is no user-facing "sign out of all devices" affordance: a user who suspects a leaked cookie (the file headers themselves call out "a leaked/stolen copy stays valid for the full TTL", src/app/api/auth/logout/route.ts:9) has no way to force-revoke other sessions while keeping the current one. The header only renders a per-browser "Sign out" form (src/components/Brand.tsx:70).
- **User value**: Security-conscious users and org admins get a self-serve kill switch for a lost laptop or shared machine. It also turns an already-built backend capability (session versioning) into a visible trust signal that matters for a SaaS handling private-repo data.
- **Implementation sketch**: Add a same-origin `POST` route mirroring logout's CSRF guard that calls `bumpSessionVersion(session.login)` *without* re-issuing the current cookie, or re-mints the current session at the new version so only this browser survives; surface it as a button on `/connect` next to "Re-sync access". The verdict plumbing in `getSessionState` already enforces the bump on the next request of every other session.
- **Effort**: S

## 2. Reflect org-level access loss in member sessions (revocation completeness)
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/db/installations.ts:73, src/app/api/app/webhook/route.ts:207
- **Gap**: When the App is uninstalled/suspended on an **org**, `removeInstallation` bumps the session version only for the *owner login* slug — and the code comment admits "for an org account no session carries that login, so the bump is a harmless no-op" (src/lib/db/installations.ts:69-72). Sessions are keyed on the signed-in user's own `login` (src/lib/auth.ts:55, `buildSession`), and they carry a baked-in `installations` array. So a member whose org just lost access keeps a stale `installations` entry granting `requireOrgAccess`/`readableOrgForOwner` reads (src/lib/authz.ts:31, src/lib/auth.ts:276) for up to the 7-day TTL, until they manually "Re-sync". There is no mapping from org → member logins to bump.
- **User value**: Org admins get the security guarantee they assume they already have — removing the App actually cuts off members promptly, not days later. Closes a real cross-tenant staleness window in a multi-tenant product.
- **Implementation sketch**: On `installation`/`installation_repositories` removal in the webhook, enumerate the member logins (persist them at login, or fetch App members) and `bumpSessionVersion` each; or cheaper, store an org-level "access epoch" and have `verifySessionVersion` additionally compare each embedded installation's login against its org epoch. The webhook's `removeInstallation` path is already the natural hook.
- **Effort**: M

## 3. Lightweight client session-status endpoint (`/api/auth/session`)
- **Severity**: High
- **Category**: integration
- **File**: src/lib/auth.ts:223 (`getSessionState` already computes everything; no route exposes it)
- **Gap**: Every consumer of session state is a server component (`getSession`/`getSessionState` in Brand.tsx, connect/page.tsx, authz.ts). There is no JSON endpoint a client component or external integration can poll for "am I still signed in / who am I / when does this expire" — grep for `/api/auth/me|session-status|whoami` returns nothing. `getSessionState` already returns `status` ("active"|"expired"|"none") and `expiresAt`, but that richness never reaches the browser, so the UI can't proactively warn before the inactivity horizon lapses or refresh badges/usage without a full page reload.
- **User value**: Enables a "your session expires in N minutes" nudge, client-side gating of fetches, and lets the embeddable-badge / CLI-style integrations verify auth without scraping HTML. Power users wiring Ascent into dashboards get a stable contract.
- **Implementation sketch**: Add `GET /api/auth/session` returning `{ login, image, status, expiresAt, installations: [login] }` from `getSessionState()` (omit ids/token-adjacent data). Because resolving it runs the silent-refresh path, a periodic client poll also slides the inactivity window for genuinely-active users.
- **Effort**: S

## 4. Surface "stale installations" and one-click re-sync where access is denied
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/authz.ts:36, src/components/SignInNotice.tsx:10
- **Gap**: The re-sync flow exists but is buried on `/connect` ("Added a repo or org on GitHub but don't see it here?", connect/page.tsx:182-198). When a session's embedded `installations` are stale, `requireOrgAccess` returns a flat `403 "You don't have access to this organization."` (src/lib/authz.ts:40) and protected pages fall back to `readableOrgForOwner` → "public" silently (src/lib/auth.ts:276). The user is never told "your access list may be out of date — re-sync" at the point of failure; `SignInNotice` only handles the not-signed-in / expired cases, not the partially-stale case.
- **User value**: A user who just installed the App on a new org but hits a 403 immediately understands the fix is "re-sync", not "I lack permission". Removes a confusing dead-end and a likely support ticket.
- **Implementation sketch**: Add an `expired`-style variant to `SignInNotice` (or a small `ReSyncNotice`) rendered when access is denied but a session *does* exist, reusing `GitHubSignInButton resync next={currentPath}`. Have `requireOrgAccess`'s 403 body include a `resync: true` hint so client callers can route to it.
- **Effort**: S

## 5. Persist a login audit trail (last sign-in, IP/UA, session count)
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/api/auth/callback/route.ts:77 (where the session is minted), src/lib/db/sessions.ts
- **Gap**: The callback already loads the GitHub user and writes installations + session version to the DB, but records nothing about the sign-in event itself. There is no `lastLoginAt`, request IP/User-Agent, or session-count anywhere — the `SessionRevocation` row stores only `login` + `version` (src/lib/db/sessions.ts). For a SaaS with usage metering and org dashboards, there's no way to show "last active" or detect anomalous logins.
- **User value**: Org admins get a security/activity view (who logged in, when, from where); the product gains the raw data for future "suspicious login" alerts and for the existing usage-metering story. Users get reassurance via a visible login history.
- **Implementation sketch**: Extend the revocation upsert (or add a `LoginEvent` table) written best-effort in the callback's existing `try` block from `request.headers` (`x-forwarded-for`, `user-agent`) and `Date.now()`. Render a compact "Recent sign-ins" list on `/connect` or `/usage`, both of which already read the session. Keep it guarded so DB-off mode is unaffected, matching the prevailing best-effort pattern.
- **Effort**: M

## 6. "Stay signed in" copy / configurable inactivity horizon
- **Severity**: Low
- **Category**: user_benefit
- **File**: src/lib/auth.ts:30 (`SESSION_TTL_MS`), src/components/SignInNotice.tsx:18
- **Gap**: The inactivity horizon is a hard-coded 7-day constant (`SESSION_TTL_MS = 7 * 86_400_000`) with silent refresh, and the only user-visible mention is after the fact: the expired banner says "You were signed out after a period of inactivity" (SignInNotice.tsx:18). Users are never told up front how long a session lasts, and there's no choice between a short (shared-machine) and long (personal) horizon — both common expectations set by GitHub/Vercel's own login UX.
- **User value**: Sets accurate expectations (fewer surprise logouts), and a "this is a shared computer → shorter session" toggle is a small trust/security win the audience expects.
- **Implementation sketch**: Thread an optional remember-me flag from `GitHubSignInButton` → login route → into `buildSession` to pick a short vs long `rexp`; add a one-line "Sessions stay active for 7 days of inactivity" hint near the sign-in button. The dual-expiry machinery (`exp`/`rexp` in src/lib/auth.ts) already supports per-session horizons, so this is mostly copy + one parameter.
- **Effort**: S
