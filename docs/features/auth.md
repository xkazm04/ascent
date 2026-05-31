# Auth

Auth is **optional** in Ascent. With the OAuth env vars unset, the whole app works
anonymously — public scans, badges, gate, even DB-backed reads of public orgs. When
configured, GitHub OAuth signs a user in to scope private org data and their GitHub App
installations to them. There is no separate password system and no GitHub access token is
ever persisted to the client.

## Session model (`src/lib/auth.ts`)

The session is a **signed, HTTP-only cookie** (`ascent_session`), HMAC-SHA256 over a
base64url payload, 7-day TTL with a 2-day sliding renewal window:

```ts
{ login, name?, image?, installations: UserInstallation[], exp }
```

Because browsers cap a cookie at ~4 KB, `buildSession()` tail-drops installations when a
user has many orgs (dropped orgs simply read as `public`) and logs the cap;
`encodeSession()`/`decodeSession()` enforce the size limit loudly.

**Exports:**

| Function | Role |
| --- | --- |
| `getSession()` | Current signed-in session, or null. |
| `getSessionState()` | Adds renewal + distinguishes `none` / `expired` / `active`. |
| `isAuthConfigured()` | Env guard (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `AUTH_SECRET`). |
| `readableOrgForOwner(owner)` | Org slug a viewer may read (their own login if installed, else `public`). |
| `orgOptionsForSession()` | Orgs the viewer can switch between (installations + `public`). |
| `getActiveOrg()` | Reads `ascent_active_org`, falls back to first installation or `public`. |
| `safeNext()` | Validates a post-login redirect target (blocks absolute / protocol-relative / control-char URLs). |

## OAuth flow

| Route | Method | Behavior |
| --- | --- | --- |
| `/api/auth/login` | `GET` | Set CSRF `state` cookie (10-min) + `next` redirect cookie (and optional `resync=1`); redirect to GitHub authorize with scope `read:user`. |
| `/api/auth/callback` | `GET` | Verify `state`, exchange `code` for a token, fetch the user + their App installations (`/user/installations`), `upsertInstallation()` each, set the signed session, then redirect — `?resynced=1` on re-sync, or `/launch?next=…` on first sign-in. The GitHub token is used here and discarded. |
| `/api/auth/logout` | `POST` | Same-origin check, delete the session cookie, redirect to `/`. |

`fetchUserInstallations()` retries transient failures with backoff (a past bug baked empty
arrays into 7-day sessions, locking users out).

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
| `src/lib/auth.ts` | Session signing/verification, OAuth URL building, session state, redirect safety. |
| `src/lib/auth.test.ts` | Encode/decode + size-limit tests. |
| `src/app/api/auth/login\|callback\|logout/route.ts` | The OAuth endpoints. |
| `src/components/GitHubSignInButton.tsx`, `SignInNotice.tsx` | Sign-in UI. |

## Known gaps

- **Single-user sessions** — `User`/`Membership` models exist for future org invites but
  no invite/permission flow is wired.
- **Read scope only** — OAuth requests `read:user`; repo writes (practices PRs, checks) go
  through the [GitHub App](github-app.md) installation token, not the user token.
- **Installation cap** — users in very many orgs may have tail installations dropped from
  the cookie (they fall back to `public`).
