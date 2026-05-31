# Ascent — Setup & preconditions (connect-it-all)

Everything that needs external credentials to activate. The MVP runs with **none** of
these (public scans in mock mode); add them to unlock each capability.

`{host}` = your deployed URL (e.g. `https://ascent.vercel.app`) or `http://localhost:3000`.

## 1. App endpoints external services must point at

These already exist in the app — register them in the relevant dashboards:

| Purpose | URL to register |
|---|---|
| GitHub App **Setup URL** (post-install redirect) | `{host}/api/app/setup` |
| GitHub App **Webhook URL** | `{host}/api/app/webhook` |
| GitHub App / OAuth **Callback URL** | `{host}/api/auth/callback` |
| User install link (also a button on `/connect`) | `https://github.com/apps/<app-slug>/installations/new` |

> Callback/Setup/Webhook URLs must match **exactly**. GitHub Apps allow several, so add
> both `http://localhost:3000/...` and your production `{host}/...`.

## 2. What to create, where, and the env var it yields

| # | Unlocks | Create it at | Env var(s) |
|---|---|---|---|
| A | **Live LLM scoring** (vs mock) | https://aistudio.google.com/apikey | `GEMINI_API_KEY` (opt: `GEMINI_MODEL`) |
| B | Higher public rate limits (optional) | https://github.com/settings/tokens (fine-grained: Contents + Metadata read) | `GITHUB_TOKEN` |
| C | **Persistence**: history, trends, usage metering, recommendation tracking, installs | Local: `docker compose up -d` (in repo). Prod: Aurora DSQL (#F) | `DATABASE_URL` |
| D | **GitHub App** → private-repo scans | https://github.com/settings/apps/new (org: `…/organizations/<org>/settings/apps/new`). Perms: **Contents: Read**, **Metadata: Read**. Subscribe: **Installation**. Set the 3 URLs from §1. Generate a **private key** (.pem). | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (base64 the .pem), `GITHUB_APP_WEBHOOK_SECRET` |
| E | **Sign-in (OAuth)** → gates `/connect`, `/usage`, `/trends`; scopes `/connect` to the user's installs | **Same App** as #D: note **Client ID**, generate a **client secret**, add Callback URL `{host}/api/auth/callback` | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`) |
| F | **Production DB** (Aurora DSQL) | AWS Console → Aurora DSQL → create cluster (perpetual free tier; Postgres-compatible) | `DATABASE_URL` (password = short-lived IAM token) |
| G | **Enterprise private inference** | AWS Console → Bedrock → enable Claude Sonnet 4.6 access + IAM creds | `LLM_PROVIDER=bedrock`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, AWS creds |
| H | **Deploy** | https://vercel.com → import repo → add env above → deploy (gives you `{host}`) | (Vercel project env) |

Walkthroughs: [GITHUB_APP.md](./GITHUB_APP.md) (App + OAuth), [ARCHITECTURE.md](./ARCHITECTURE.md)
(DSQL + Bedrock). Every variable is documented in [`.env.example`](../.env.example).

## 3. Recommended order

1. `npm run dev` → scan a public repo (works with **zero** keys, mock mode).
2. Add `GEMINI_API_KEY` → live scoring.
3. `docker compose up -d` + `DATABASE_URL` + `npm run db:push` → history / trends / usage / tracking.
4. Create the **GitHub App** (#D) → point its 3 URLs at your `{host}` → fill the 4 `GITHUB_APP_*` vars → install via `/connect` → scan a **private** repo (becomes billable in `/usage`).
5. Add **OAuth** (#E, the same App's client id/secret + `AUTH_SECRET`) → sign-in gating turns on.
6. **Deploy to Vercel** (#H); re-point the App URLs from `localhost` to your Vercel `{host}`.
7. Enterprise (optional): Aurora DSQL (#F) + `LLM_PROVIDER=bedrock` (#G).

## 4. Degradation map (what works without what)

| Missing | Effect |
|---|---|
| `GEMINI_API_KEY` | Deterministic **mock** scoring (still fully demoable). |
| `DATABASE_URL` | Scans work; `/trends`, `/usage`, recommendation tracking, App installs disabled (clean notices). |
| `GITHUB_APP_*` | Public repos only; `/connect` shows "not configured". |
| OAuth env (`GITHUB_OAUTH_*`, `AUTH_SECRET`) | App runs **open** (no sign-in, pages not gated). Setting it closes the access-control gap. |

## 5. Notes

- **OAuth reuses the GitHub App's own client id/secret** (not a separate OAuth app) — that's
  what lets a signed-in user list *their* installations via `/user/installations`.
- The GitHub token / installation token is used only **server-side**; the session cookie is
  HMAC-signed and httpOnly — no token reaches the browser.
- Status as of this writing: all mechanisms verified locally; the live browser flows
  (App install, OAuth sign-in, private scan) require the App to exist in your account.
