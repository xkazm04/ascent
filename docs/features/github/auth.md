# Auth

Ascent has **two GitHub sign-in stacks**. Knowing which one is live is the single
most important thing on this page — configuring the wrong one produces an app with
no working sign-in.

| Stack | Status | Env | Entry point |
| --- | --- | --- | --- |
| **Supabase GitHub OAuth** | **ACTIVE** — the production login wall | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/access.ts`, `src/app/auth/callback` |
| Custom GitHub OAuth | **Dormant** — kept, unconfigured in production | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `AUTH_SECRET` | `src/lib/auth.ts`, `src/app/api/auth/*` |

Auth is **optional** in either case. With neither stack configured the whole app
works anonymously — public scans, badges, gate, even DB-backed reads of public
orgs. No GitHub access token is ever persisted to the client.

Supabase dashboard setup is a one-time manual prerequisite: Authentication →
Providers → enable GitHub with a GitHub OAuth App's client ID/secret (its callback
is `{SUPABASE_URL}/auth/v1/callback`), then Authentication → URL Configuration →
add `{host}/auth/callback` to the redirect URLs.

## Is the wall up? (`src/lib/env.ts`)

Three pure predicates, shared by the server gate and the proxy so they can't drift:

| Predicate | Meaning |
| --- | --- |
| `supabaseAuthConfigured()` | Both `NEXT_PUBLIC_SUPABASE_*` vars are set. |
| `authBypassEnabled()` | `ASCENT_AUTH_BYPASS` is on **and** `NODE_ENV !== "production"`. Hard-disabled in production, so a stray env var can never drop the wall on a real deployment. |
| `authGateEnabled()` | `supabaseAuthConfigured() && !authBypassEnabled()` — whether the wall is actually enforced right now. |

## The active stack (`src/lib/access.ts`)

`access.ts` is the single gate the rest of the app consults. It is **server-only**
(reads cookies via the Supabase server client); never import it from a client
component.

| Export | Role |
| --- | --- |
| `getViewer()` | The signed-in `Viewer` (`id`, `login`, `email?`, `avatar?`, `name?`) or null. Returns a synthetic `DEV_VIEWER` (`login: "developer"`) when the bypass is on. Uses `supabase.auth.getUser()`, which validates the JWT against the auth server, so the result is trustworthy. Memoized per render with React `cache()`. A transient auth-server error is treated as signed-out rather than crashing the render. **`email` is surfaced only when Supabase reports it confirmed (`email_confirmed_at`)** — see below. |
| `requireViewer()` | API-route gate — returns a 401 `NextResponse` when the wall is enforced and there's no viewer, else null. No-op when the gate is disabled. |
| `resolveViewerLogin()` | Identity across **both** stacks: the custom-OAuth session wins, then the Supabase / bypass viewer, else null. Used where data is keyed on identity (e.g. Org Memory's `visibility='private'` filter). |

> ⚠️ `resolveViewerLogin()` and `getViewer()` must be awaited in a route or render
> body — **never inside a `ReadableStream` start()**, where the cookie-scoped reads
> they depend on return null.

### `viewer.email` is a confirmed address or nothing

Supabase sets `user.email` at *registration*, confirmed or not, so the raw field
proves nothing about who owns the address. `getViewer()` therefore surfaces `email`
only when `user.email_confirmed_at` is non-null; an unconfirmed account is still a
signed-in viewer (with its `login`), just one with no email. Everything keyed on the
address fails closed as a result:

| Consumer | Unconfirmed viewer |
| --- | --- |
| `acceptInvite()` email-pinned binding (`POST /api/org/invites/accept`) | `wrong_email` — registering an unconfirmed account at the invited address can no longer hijack someone else's invite. |
| `POST /api/scan/stream` completion email | No notification is sent (the client-supplied `email` is honored only on the anonymous funnel), so Ascent's verified sending domain never mails an unproven address. |
| `GET /api/auth/viewer` → `NotifyToggle` | `email: null` — the toggle shows the existing "no account email" explanation instead of an address. |

`login`'s email fallback is **confirmed-only too** (G2-31). `login` is not merely a
display key — `viewerOrgRole`/`getMembershipRole` resolve an org role for it, and
`acceptInvite()`'s *githubLogin* pin compares against it — so falling back to the raw
`user.email` reopened the same hijack through a second field: register an unconfirmed
account at `victim@example.com` and you are signed in *as* that string. The resolution
order is now `user_name → preferred_username → confirmed email → user id`; an account
with neither GitHub metadata nor a confirmed address gets the opaque `user.id`, which is
safe to re-key because such an account could never have proven that identity in the first
place. The other half of the pair is `POST /api/org/invites`, whose GitHub-login shape
check (`/^[A-Za-z0-9-]{1,39}$/`) refuses to *store* an `@`-bearing pin — so either half
alone closes the hole. Production sign-ins are GitHub OAuth (already confirmed, and they
carry `user_name`), so neither fallback is reached there.

**Cookie refresh** — `src/proxy.ts` (Next.js 16 Proxy, formerly Middleware) reads the
session on each request so supabase-js can re-mint an expiring token, and writes the
refreshed cookies onto the response. Without it a user whose access token lapsed
mid-session would be silently signed out on the next navigation. It short-circuits
when `!authGateEnabled()`.

**Sign-in prompt** — `src/lib/signin-gate.ts` decides *whether* to prompt and *which
button* to show (`provider: "supabase" | "github"`), checking the active wall first.
This exists because pages used to open-code `isAuthConfigured() && !session`, a
predicate keyed on the dormant stack — so the prompt never fired, and where it did
it offered the dormant button, which dead-ends at `/connect?error=not_configured`.

**UI** — `src/components/SupabaseAuthButtons.tsx` (`SupabaseSignInButton` /
sign-out) drives the browser → Supabase → GitHub → `/auth/callback` redirect. It's
styled to match the dormant stack's `GitHubSignInButton.tsx` so the affordance looks
identical either way. `SignInNotice.tsx` distinguishes "Your session expired" from
"Sign in to continue".

## Endpoints

| Route | Method | Behavior |
| --- | --- | --- |
| `/auth/callback` | `GET` | **Supabase.** Exchanges the PKCE `?code=` for a session (setting auth cookies), then redirects to `?next=` — run through `safeNext()` so a tampered value can't bounce to an external origin. Defaults to `/launch`. Also **seeds the watchlist** from the exchange's GitHub `provider_token`, deferred via `after()` so sign-in latency is untouched — see [Org auto-discovery](#org-auto-discovery-srclibgithubdiscoverts). |
| `/api/auth/session` | `GET` | Dual-stack JSON session status for client components and "session expires in N minutes" nudges. Under the Supabase wall the Supabase viewer is reported, `installations` is always `[]` (App installs resolve per-org via `canReadOrg`), and `expiresAt` is null (Supabase refreshes its own tokens). Otherwise falls through to custom-OAuth state. No token is ever in the payload. |
| `/api/auth/viewer` | `GET` | The *effective* viewer for client components (the scan form's notify control) — honors the dev bypass viewer, unlike a raw client-side Supabase call. Returns `{ signedIn, email, gated }`. |
| `/api/auth/login` | `GET` | **Dormant stack.** CSRF `state` cookie + `next` cookie, redirect to GitHub authorize with scope `read:user read:org`. |
| `/api/auth/callback` | `GET` | **Dormant stack.** Verify `state`, exchange `code`, fetch user + App installations, `upsertInstallation()` each, auto-discover orgs, set the signed session. The GitHub token is used here and discarded. |
| `/api/auth/logout` | `POST` | Same-origin check, bump the login's session version (server-side revocation), delete the cookie, redirect to `/`. |
| `/api/auth/revoke-sessions` | `POST` | **Dual-stack** "sign out everywhere else". Under the wall: `supabase.auth.signOut({ scope: "others" })` — revokes every other refresh token server-side and deliberately leaves *this* browser signed in; a failed revoke reports `?error=revoke` rather than claiming success. Dormant stack: bumps the session version so other devices and any leaked cookie copy are rejected, re-minting *this* cookie at the new version (best-effort — with no DB there is no revocation authority). POST-only + same-origin either way, mirroring logout's CSRF guard. |

---

## The dormant stack (`src/lib/auth.ts`)

Still present and fully implemented; unconfigured in production. Documented because
it remains the code path when `GITHUB_OAUTH_*` **is** configured (some local and
e2e setups), and because `resolveViewerLogin()` still gives it precedence.

`AUTH_SECRET` is **load-bearing, not optional**: `signSession()` throws without it and
`decodeSession()` refuses every cookie. The HMAC key would otherwise fall back to the
empty string, and since two callers (`/api/auth/logout`, `/api/auth/revoke-sessions`)
decode before any `isAuthConfigured()` check, anyone could forge a session for any login
against a deployment that set `GITHUB_OAUTH_*` but not `AUTH_SECRET`.

The session is a **signed, HTTP-only cookie** (`ascent_session`), HMAC-SHA256 over a
base64url payload:

```ts
{ login, name?, image?, installations: UserInstallation[], exp, rexp?, sv?, suggestedOrgs?, seededOrg? }
```

- `exp` — short access expiry (~1 h). Past it the server re-affirms against the
  revocation store and re-mints (*silent refresh*); not a hard expiry.
- `rexp` — inactivity horizon (7 days), slid forward on each active request. This is
  the hard expiry `decodeSession()` enforces. Legacy cookies predate it and fall back
  to the old long-lived `exp`.
- `sv` — session version for server-side revocation.
- `suggestedOrgs` / `seededOrg` — login-time org auto-discovery; both optional.

Because browsers cap a cookie at ~4 KB, `buildSession()` sheds the lowest-value
fields first — org suggestions, then the seeded-org pointer — before tail-dropping
installations (dropped orgs read as `public`).

### Server-side revocation

Stateless signed cookies have no off switch. A per-login **session version** closes
that gap: the authority lives in `SessionRevocation` (`src/lib/db/sessions.ts`),
`buildSession()` stamps it into `sv`, and `getSessionState()` re-checks on every
resolve. Logout, `revokeOtherSessions`, and App uninstall/suspend all bump it.

With no DB there is no authority, so auth degrades to stateless TTL-only behavior.
When the DB *is* the authority but a lookup fails, the check **fails open** — a
transient blip shouldn't log everyone out — bounded by the short access TTL.

| Function | Role |
| --- | --- |
| `getSession()` | Current signed-in session, or null. |
| `getSessionState()` | Revocation check + silent refresh; distinguishes `none` / `expired` / `active`. |
| `isAuthConfigured()` | Env guard for this stack. **False in production** — do not use it to decide whether anyone is signed in. |
| `readableOrgForOwner(owner)` | Org slug a viewer may read. |
| `orgOptionsForSession()` | Orgs the viewer can switch between. |
| `getActiveOrg()` | Reads `ascent_active_org`, falls back to first installation or `public`. |
| `safeNext()` | Validates a post-login redirect (blocks absolute / protocol-relative / control-char URLs). Shared with the Supabase callback. |

### Org auto-discovery (`src/lib/github/discover.ts`)

A brand-new user has no App installation, so the callback uses the short-lived user token
to list their orgs (`/user/orgs`) and recently-pushed repos (`/user/repos`), ranks each
org by activity, then **suggests** not-yet-installed orgs in onboarding and **pre-seeds
the watchlist** for the most active one via `seedWatchlist()`. Best-effort throughout — a
denied scope or rate limit degrades to fewer suggestions and never blocks sign-in.
Ranking is pure and unit-tested; seeding is idempotent.

`discoverOrgsForLogin()` in `src/lib/auth-discovery.ts` is the shared entry point, called
by **both** callbacks. It used to be module-private inside the dormant `route.ts` — where
only HTTP handlers may be exported — so the live stack could not reach it at all.

What each stack gets differs, and the difference is intrinsic:

| | Dormant custom stack | Supabase wall (production) |
| --- | --- | --- |
| Token issuer | the Ascent App's own OAuth client | Supabase's OAuth client |
| Watchlist seeding | yes, inline | yes, deferred via `after()` |
| `/user/installations` | available → private repos may be seeded | unavailable → `selectSeedTarget` seeds **public repos only**, which is correct (an uninstalled org can't mint a token, so private rows would be dead entries) |
| `suggestedOrgs` surfaced | yes (embedded in the signed cookie) | not yet — see Known gaps |

> For a GitHub **App** user-to-server token the OAuth `scope` is advisory — access is
> governed by the App's permissions — so `/user/orgs` may return less than a classic
> OAuth token would.

## Known gaps

- **Some sign-in-moment product behavior still doesn't run in production.** The
  Supabase callback now seeds the watchlist (above), but three behaviors remain
  exclusive to the dormant custom callback: `upsertInstallation()` owner→installation
  linking (prod links only via the `/api/app/setup` webhook), session
  revocation-version stamping, and the `resync=1` round-trip. Linking in particular
  **cannot** simply be ported — it needs an App-client token, which Supabase's
  `provider_token` is not.
- **Discovered org suggestions aren't surfaced under the wall.** `connect/page.tsx`
  reads `seededOrg`/`suggestedOrgs` off the dormant session cookie, so a production
  viewer gets the seeding but never sees the "you might want to install on…" list.
  Needs a render-side change to read discovery from somewhere the live stack has.
- **The "sign out everywhere else" button is unreachable in production.**
  `/api/auth/revoke-sessions` now works on both stacks, but `connect/page.tsx` renders
  its form only inside a `{session && …}` block — the dormant cookie — so a Supabase
  viewer cannot click it.
- **Read scope only** — the dormant stack requests `read:user read:org`; repo writes
  (practice PRs, checks) go through the [GitHub App](./github-app.md) installation
  token, not a user token.
- **Installation cap** (dormant stack) — users in very many orgs may have tail
  installations dropped from the cookie; those orgs fall back to `public`.
- **Org-member revocation on uninstall** (dormant stack) — `removeInstallation`
  bumps the version for the *owner* login, which precisely targets personal-account
  installs. For an org account, member logins aren't mapped to the installation
  server-side, so their sessions aren't force-revoked; they pick up the change on
  re-sync or within the short access TTL. Precise revocation would need a
  login↔installation index.
