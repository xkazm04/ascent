# Ascent — Setup & preconditions (connect-it-all)

Everything that needs external credentials to activate. Ascent runs with **none** of
these (public scans in mock mode); add them to unlock each capability.

`{host}` = your deployed URL (e.g. `https://ascent.vercel.app`) or `http://localhost:3000`.

> ⚠️ **Sign-in is Supabase, not the custom OAuth flow.** Ascent has two GitHub
> sign-in stacks. The **active** one is Supabase GitHub OAuth (row E below). The
> `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` / `AUTH_SECRET` stack is
> kept but **dormant** — configuring only it yields an app with no working login
> wall. See [features/github/auth.md](./features/github/auth.md).

## 1. App endpoints external services must point at

These already exist in the app — register them in the relevant dashboards:

| Purpose | URL to register |
|---|---|
| GitHub App **Setup URL** (post-install redirect) | `{host}/api/app/setup` |
| GitHub App **Webhook URL** | `{host}/api/app/webhook` |
| Supabase **Redirect URL** (Authentication → URL Configuration) | `{host}/auth/callback` |
| GitHub OAuth App callback **for Supabase** (Supabase dashboard gives this) | `{SUPABASE_URL}/auth/v1/callback` |
| Dormant custom-OAuth callback (only if using that stack) | `{host}/api/auth/callback` |
| User install link (also a button on `/connect`) | `https://github.com/apps/<app-slug>/installations/new` |

> Setup/Webhook URLs must match **exactly**. GitHub Apps allow several, so add both
> `http://localhost:3000/...` and your production `{host}/...`.

## 2. What to create, where, and the env var it yields

| # | Unlocks | Create it at | Env var(s) |
|---|---|---|---|
| A | **Live LLM scoring** (vs mock) | https://aistudio.google.com/apikey | `GEMINI_API_KEY` (opt: `GEMINI_MODEL`) |
| B | Higher public rate limits (optional) | https://github.com/settings/tokens (fine-grained: Contents + Metadata read) | `GITHUB_TOKEN` |
| C | **Persistence**: history, trends, usage metering, recommendation tracking, installs | Local: **embedded PGlite** (no install — see §3). Or `docker compose up -d`. Prod: Aurora DSQL (#F) | `PGLITE_DATA_DIR` + `DATABASE_URL` |
| D | **GitHub App** → private-repo scans | https://github.com/settings/apps/new (org: `…/organizations/<org>/settings/apps/new`). Perms: **Contents: Read**, **Metadata: Read**. Subscribe: **Installation**. Set the URLs from §1. Generate a **private key** (.pem). | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (base64 the .pem), `GITHUB_APP_WEBHOOK_SECRET` |
| E | **Sign-in (ACTIVE)** → the login wall over `/org/*`, private scans, `/connect`, `/usage`, `/trends` | https://supabase.com → new project. Then **Authentication → Providers → GitHub**: paste a GitHub OAuth App's client ID/secret (that OAuth App's callback = `{SUPABASE_URL}/auth/v1/callback`). Then **Authentication → URL Configuration**: add `{host}/auth/callback`. | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| E′ | *(optional, dormant)* the legacy custom-OAuth stack | **Same App** as #D: note **Client ID**, generate a client secret, add callback `{host}/api/auth/callback` | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`) |
| F | **Production DB** (Aurora DSQL) | AWS Console → Aurora DSQL → create cluster (perpetual free tier; Postgres-compatible) | `DATABASE_URL` (password = short-lived IAM token) |
| G | **Enterprise private inference** | AWS Console → Bedrock → enable Claude Sonnet access + IAM creds | `LLM_PROVIDER=bedrock`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, AWS creds |
| H | **Deploy** | https://vercel.com → import repo → add env above → deploy (gives you `{host}`) | (Vercel project env) |

The anon key is public by design — Row-Level Security protects the data — so it's
safe client-side.

**Other LLM providers** (all optional, pick one via `LLM_PROVIDER`): `openai`
(`OPENAI_API_KEY`, opt. `OPENAI_BASE_URL` for any compatible gateway), `openrouter`
(`OPENROUTER_API_KEY`), `claude-cli` (local `claude` CLI on your subscription —
no key), `mock` (keyless). Full table:
[features/scanning/llm-providers.md](./features/scanning/llm-providers.md).

Walkthroughs: [features/github/setup.md](./features/github/setup.md) (App creation),
[features/github/auth.md](./features/github/auth.md) (both sign-in stacks),
[ARCHITECTURE.md](./ARCHITECTURE.md) (DSQL + Bedrock). Every variable is documented
in [`.env.example`](../.env.example).

## 3. Recommended order

1. `npm run dev` → scan a public repo (works with **zero** keys, mock mode).
2. Add `GEMINI_API_KEY` → live scoring.
3. **Local DB, no install:** keep the default `PGLITE_DATA_DIR=.pglite/ascent` — an
   embedded in-process Postgres-in-WASM that `npm run dev` boots via
   `src/instrumentation.ts`. `DATABASE_URL` must still be set, but a dummy is fine
   (the PGlite driver adapter provides the connection; the URL is ignored). Then
   `npm run db:push`, and `npm run db:local:seed` for real data.
   *Prefer a real Postgres?* `docker compose up -d`, set the real `DATABASE_URL`,
   and unset `PGLITE_DATA_DIR`.
4. Create the **GitHub App** (#D) → point its URLs at your `{host}` → fill the four
   `GITHUB_APP_*` vars → install via `/connect` → scan a **private** repo (becomes
   billable in `/usage`).
5. Add **Supabase sign-in** (#E) → the login wall turns on. For local work you can
   skip it and set `ASCENT_AUTH_BYPASS=1` instead (see §4).
6. **Deploy to Vercel** (#H); re-point the App + Supabase URLs from `localhost` to
   your Vercel `{host}`.
7. Enterprise (optional): Aurora DSQL (#F) + `LLM_PROVIDER=bedrock` (#G).

## 4. Degradation map (what works without what)

| Missing | Effect |
|---|---|
| `GEMINI_API_KEY` | Deterministic **mock** scoring (still fully demoable). |
| `DATABASE_URL` / `PGLITE_DATA_DIR` | Scans work; `/trends`, `/usage`, recommendation tracking, App installs disabled (clean notices). |
| `GITHUB_APP_*` | Public repos only; `/connect` shows "not configured". |
| `NEXT_PUBLIC_SUPABASE_*` | App runs **open** — no sign-in, pages not gated. Setting both closes the access-control gap. |
| `GITHUB_OAUTH_*` / `AUTH_SECRET` | No effect on the login wall (dormant stack). Only affects the legacy flow. |

`ASCENT_AUTH_BYPASS=1` drops the wall for local work — every gate passes as a
synthetic `developer` viewer. It is **hard-disabled when `NODE_ENV=production`**, so
a stray value can't open a real deployment.

## 5. Notes

- **Supabase needs a GitHub OAuth App of its own** (callback
  `{SUPABASE_URL}/auth/v1/callback`), configured in the Supabase dashboard — that
  step is manual and not driven by any env var here.
- The dormant stack reuses the GitHub **App's** client id/secret rather than a
  separate OAuth app — that's what let a signed-in user list *their* installations
  via `/user/installations`.
- GitHub and installation tokens are used only **server-side**; no token reaches the
  browser.
- **Known gap:** a brand-new production sign-in lands on an empty dashboard. Org
  auto-discovery and watchlist seeding run only in the dormant callback, so they
  don't fire under the Supabase wall — see
  [features/github/auth.md](./features/github/auth.md) "Known gaps".
