# Ascent — GitHub App setup (private repositories)

The GitHub App lets Ascent scan **private** repositories using a short-lived
**installation access token** minted per request. Ascent never stores source — only the
derived scores/evidence. Private scans are attributed to the installing org and counted
as **billable** units in [usage metering](../src/lib/db/usage.ts).

Public scans need none of this; the App is only for private repos.

## 1. Create the App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.

| Field | Value |
|---|---|
| **GitHub App name** | e.g. `ascent-maturity` (its slug becomes `GITHUB_APP_SLUG`) |
| **Homepage URL** | your deployment URL |
| **Setup URL** (post-install redirect) | `https://<host>/api/app/setup` · check **"Redirect on update"** off is fine |
| **Webhook URL** | `https://<host>/api/app/webhook` |
| **Webhook secret** | a random string → `GITHUB_APP_WEBHOOK_SECRET` |

**Repository permissions.** Scanning needs only read access; the in-workflow features (PR
maturity gate, push-driven re-scan, and "open a practice starter PR") need a little write:

| Permission | Access | Why |
|---|---|---|
| **Metadata** | Read | mandatory |
| **Contents** | Read | scan private files; **Read & write** to open practice-starter PRs |
| **Pull requests** | Read & write | PR maturity-gate sticky comment; open starter PRs |
| **Checks** | Read & write | post the PR maturity-gate Check Run (the merge status) |

Grant only what you use — read-only Contents + Metadata is enough for pure scanning.

**Subscribe to events:**
- `Installation` — keeps stored installations in sync (recommended).
- `Pull request` — runs the maturity gate on each PR: scores the **PR head** (so adding tests /
  agent guidance / CI in the PR actually moves the score), diffs it against the base branch to show
  what the PR changes, and posts a Check Run + sticky comment. (CI can do the same without the App
  via the published Action / `GET /api/gate/{owner}/{repo}?ref=<pr-head-sha>`.)
- `Push` — re-scans a **watched** repo on a push to its default branch and alerts on a
  regression vs the prior scan (the "live intelligence" loop). Skip if you don't want auto-rescan.

**Where can this App be installed?** Your choice (private to your org, or public).

Create the App, then on its page:
- Note the **App ID** → `GITHUB_APP_ID`.
- **Generate a private key** (downloads a `.pem`) → `GITHUB_APP_PRIVATE_KEY`.

## 2. Configure env

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=ascent-maturity
GITHUB_APP_WEBHOOK_SECRET=<the webhook secret>
# Private key: paste the PEM, or (recommended) base64-encode it to keep it single-line:
#   base64 -w0 ascent.private-key.pem        (Linux)
#   certutil -encode ... / [Convert]::ToBase64String(...)   (Windows)
GITHUB_APP_PRIVATE_KEY=<base64-encoded PEM, or raw PEM with \n escapes>
```

`GITHUB_APP_PRIVATE_KEY` accepts either a raw PEM (literal or `\n`-escaped newlines) or a
base64-encoded PEM — the loader detects which.

Requires `DATABASE_URL` too (installations are stored on `Organization.githubInstallId`).

## 3. Install & scan

1. Visit **`/connect`** → **Install on GitHub** (uses `GITHUB_APP_SLUG`).
2. Pick the repositories to grant access to.
3. GitHub redirects to `/api/app/setup?installation_id=…`, which stores the installation
   and bounces you to `/connect?org=<login>` with your repo list.
4. Click **Scan** on any repo — the scan route resolves the installation token by owner,
   reads the repo via the authenticated Contents API, and persists the result under your
   org (private → billable).

## 4. Enable sign-in (GitHub OAuth)

Sign-in gates `/connect`, `/usage`, and `/trends`, and scopes `/connect` to the
**signed-in user's own installations**. It reuses the **same GitHub App** as its OAuth
provider, so a user's token can list their installations.

On the App's settings page:
- Note the **Client ID** → `GITHUB_OAUTH_CLIENT_ID`.
- **Generate a new client secret** → `GITHUB_OAUTH_CLIENT_SECRET`.
- Set the **Callback URL** to `https://<host>/api/auth/callback` (add
  `http://localhost:3000/api/auth/callback` too for local dev — GitHub Apps allow several).
- (Optional) enable **"Request user authorization (OAuth) during installation"** so
  install + sign-in happen together.

```bash
GITHUB_OAUTH_CLIENT_ID=Iv1.xxxxxxxx          # the App's Client ID
GITHUB_OAUTH_CLIENT_SECRET=<generated secret>
AUTH_SECRET=<random, e.g. openssl rand -base64 32>   # signs the session cookie
```

When these are **unset**, the app runs without sign-in (all pages open — fine for local
dev / public demo). When set, the session lives in an HMAC-signed httpOnly cookie; the
GitHub token is used only server-side during the callback and is never sent to the client.

## How auth works (under the hood)

- `src/lib/github/app.ts` signs an **RS256 App JWT** (Node `crypto`, no deps) and
  exchanges it for an **installation access token** (`POST /app/installations/{id}/access_tokens`),
  cached in-process until ~1 min before expiry.
- `src/lib/github/source.ts` uses the token with the **Contents API** for private files
  (the raw host only serves public content).
- `/api/app/webhook` verifies `X-Hub-Signature-256` (HMAC-SHA256) before trusting events.

## Current limitations (next steps)

- **Sign-in is implemented** (§4) — when OAuth env is set, `/connect`, `/usage`, and
  `/trends` require a session and `/connect` is scoped to the user's own installations.
  Leave it unset for an open local/demo deployment.
- **No push-triggered re-scan yet.** The webhook acks `push`; wiring it to a scheduled or
  immediate re-scan is a follow-up.
- **Enterprise inference:** set `LLM_PROVIDER=bedrock` so private code is scored via AWS
  Bedrock (in-account, no training on data) — see [ARCHITECTURE.md](./ARCHITECTURE.md).
