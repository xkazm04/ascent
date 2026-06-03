# Auth

Auth is **optional** in Ascent. With the OAuth env vars unset, the whole app works
anonymously — public scans, badges, gate, even DB-backed reads of public orgs. When
configured, GitHub OAuth signs a user in to scope private org data and their GitHub App
installations to them. There is no separate password system and no GitHub access token is
ever persisted to the client.

## Session model (`src/lib/auth.ts`)

The session is a **signed, HTTP-only cookie** (`ascent_session`), HMAC-SHA256 over a
base64url payload:

```ts
{ login, name?, image?, installations: UserInstallation[], exp, rexp?, sv?, suggestedOrgs?, seededOrg? }
```

- `exp` — **short access expiry** (~1 h). Past it the server must re-affirm the token
  against the revocation store and re-mint it (*silent refresh*); it is not a hard expiry.
- `rexp` — **inactivity horizon** (7 days), slid forward on each active request. This is
  the hard expiry `decodeSession()` enforces — an idle session lapses here. Legacy cookies
  predate `rexp` and fall back to the old long-lived `exp`.
- `sv` — **session version** for server-side revocation (below).
- `suggestedOrgs` / `seededOrg` — login-time **org auto-discovery** (below); both optional.

Because browsers cap a cookie at ~4 KB, `buildSession()` keeps the encoded value under budget
by shedding the lowest-value fields first — the discovered-org suggestions, then the seeded-org
pointer — before tail-dropping installations (dropped orgs simply read as `public`), logging the
cap; `encodeSession()`/`decodeSession()` enforce the size limit loudly.

### Server-side revocation

Stateless signed cookies have no off switch: deleting the client cookie on logout leaves a
leaked/stolen copy valid for its full TTL, and uninstalling the GitHub App isn't reflected
until the token expires. A per-login **session version** closes that gap:

- The authoritative version lives in the `SessionRevocation` table (`src/lib/db/sessions.ts`),
  keyed by GitHub login. No row means version `0`.
- `buildSession()` stamps the current version into the cookie (`sv`) at login.
- `getSessionState()` re-checks `sv` against the stored version on **every** resolve (one
  primary-key lookup) and rejects a cookie whose version is stale — so revocation is
  immediate, not deferred to the TTL.
- **Logout** (`POST /api/auth/logout`) and **App uninstall/suspend** (`removeInstallation`)
  bump the version, instantly invalidating every outstanding token for that login.

Persistence is optional: with no DB there is no revocation authority, so auth degrades to
the prior stateless, TTL-only behavior. When the DB is the authority but a lookup fails, the
check *fails open* (a transient blip shouldn't log everyone out) — but the short access TTL
still bounds how long an unaffirmed token survives, since it can't be silently refreshed
without a positive version check.

**Exports:**

| Function | Role |
| --- | --- |
| `getSession()` | Current signed-in session, or null. |
| `getSessionState()` | Checks the revocation version, silently refreshes the short access window, distinguishes `none` / `expired` / `active`. |
| `isAuthConfigured()` | Env guard (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `AUTH_SECRET`). |
| `readableOrgForOwner(owner)` | Org slug a viewer may read (their own login if installed, else `public`). |
| `orgOptionsForSession()` | Orgs the viewer can switch between (installations + `public`). |
| `getActiveOrg()` | Reads `ascent_active_org`, falls back to first installation or `public`. |
| `safeNext()` | Validates a post-login redirect target (blocks absolute / protocol-relative / control-char URLs). |

## OAuth flow

| Route | Method | Behavior |
| --- | --- | --- |
| `/api/auth/login` | `GET` | Set CSRF `state` cookie (10-min) + `next` redirect cookie (and optional `resync=1`); redirect to GitHub authorize with scope `read:user read:org`. |
| `/api/auth/callback` | `GET` | Verify `state`, exchange `code` for a token, fetch the user + their App installations (`/user/installations`), `upsertInstallation()` each, **auto-discover the user's orgs** (below), set the signed session, then redirect — `?resynced=1` on re-sync, or `/launch?next=…` on first sign-in. The GitHub token is used here and discarded. |
| `/api/auth/logout` | `POST` | Same-origin check, **bump the login's session version** (server-side revocation), delete the session cookie, redirect to `/`. |

`fetchUserInstallations()` retries transient failures with backoff (a past bug baked empty
arrays into 7-day sessions, locking users out).

### Org auto-discovery (`src/lib/github/discover.ts`)

A brand-new user has no App installation yet, so without help they'd land on a blank org
dashboard. Using the (short-lived) user token, the callback lists the orgs the user belongs to
(`/user/orgs`, hence `read:org`) and the repos they most recently pushed to (`/user/repos`), then
ranks each org by how actively the user works in it. From that ranking it:

- **suggests** the not-yet-installed orgs in onboarding (`session.suggestedOrgs`) as one-click
  "scan this org" shortcuts; and
- **pre-seeds the watchlist** for the most-active org via `seedWatchlist()` — its top repos are
  marked watched, due now, so the autoscan cron (or the dashboard's "Scan all watched") fills in
  scores. The seeded org rides along as `session.seededOrg`, surfaced as a "dashboard ready" CTA.

The whole step is **best-effort**: a denied scope, a rate-limited listing, or a DB blip degrades
to fewer (or no) suggestions — it never blocks sign-in. Ranking/selection (`rankDiscoveredOrgs`,
`selectSuggestedOrgLogins`, `selectSeedTarget`) is pure and unit-tested in `discover.test.ts`;
seeding is idempotent (only writes on first sight, so it never overrides a later user choice).

> Note: for a GitHub **App** user-to-server token the OAuth `scope` is advisory — access is
> governed by the App's permissions — so `/user/orgs` may return less than a classic OAuth token
> would. Discovery falls back to orgs inferred from repo ownership and degrades cleanly.

## UI components

- `src/components/GitHubSignInButton.tsx` — stateful client button with pending spinner,
  re-click guard, and accessible status region. Variants `primary` / `nav`.
- `src/components/SignInNotice.tsx` — shown on auth-gated pages when there's no session;
  distinguishes "Your session expired" from "Sign in to continue".

`src/components/Brand.tsx` provides `SiteHeader` (with the org switcher + session display)
and `SiteFooter`.

## Key files

| File | Role |
| --- | --- |
| `src/lib/auth.ts` | Session signing/verification, OAuth URL building, session state, revocation check + silent refresh, redirect safety. |
| `src/lib/github/discover.ts` | Login-time org auto-discovery: list + rank the user's orgs, select onboarding suggestions and the watchlist seed. |
| `src/lib/db/sessions.ts` | Per-login session-version store (`getSessionVersion` / `bumpSessionVersion`) backing revocation. |
| `src/lib/auth.test.ts` | Encode/decode + size-limit + version/horizon tests. |
| `src/app/api/auth/login\|callback\|logout/route.ts` | The OAuth endpoints. |
| `src/components/GitHubSignInButton.tsx`, `SignInNotice.tsx` | Sign-in UI. |

## Known gaps

- **Single-user sessions** — `User`/`Membership` models exist for future org invites but
  no invite/permission flow is wired.
- **Read scope only** — OAuth requests `read:user read:org` (the latter powers org
  auto-discovery); repo writes (practices PRs, checks) go through the
  [GitHub App](github-app.md) installation token, not the user token.
- **Installation cap** — users in very many orgs may have tail installations dropped from
  the cookie (they fall back to `public`).
- **Org-member revocation on uninstall** — `removeInstallation` bumps the version for the
  owner login, which precisely targets *personal-account* installs (slug == user login).
  For an **org** account, member logins aren't mapped to the installation server-side, so
  their sessions aren't force-revoked on uninstall; they instead pick up the change on
  re-sync or within the short access TTL. Precise org-member revocation would need a
  login↔installation index.
