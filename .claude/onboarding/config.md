---
app: "Ascent"
env_file: .env.local
env_example: .env.example
boot: "npm run dev"
boot_success: "GET / -> 2xx"
docs: docs/SELF-HOSTING.md
---

# Ascent — onboarding overlay

Project overlay for the registry `onboarding` skill (v0.3+). Everything below is
grounded in this repo; `.env.example` is the authoritative, fully-commented
variable reference and `docs/SETUP.md` the connect-it-all table. Ascent's design
promise: **it runs with nothing configured at all** — deterministic mock scoring
of public repos, no key, no DB, no signup.

## Install modes

| mode | consequences |
| --- | --- |
| Developer laptop (just me) | Open dev defaults. `ASCENT_SELF_HOSTED` stays unset — with no `POLAR_ACCESS_TOKEN` the app already runs self-hosted (all plan gates open, unmetered). Recommended DB: the embedded PGlite (`PGLITE_DATA_DIR=.pglite/ascent` + the dummy `DATABASE_URL` from `.env.example` §Database) — no Docker needed. `ASCENT_AUTH_BYPASS=1` is available to drop the login wall in dev only (hard-disabled in production). |
| Self-host for a team | Set `ASCENT_SELF_HOSTED=1` explicitly (unlocks the deliberate local-mode UI, keeps behavior stable even if billing vars ever appear). Run `docker compose --profile app up -d` (Postgres + the app on :3000; the image sets `ASCENT_SELF_HOSTED=1` itself) or `npm run build && npm start` against a real Postgres — then `DATABASE_URL` is required. Set `ASCENT_PUBLIC_URL` for absolute links in alerts/PR checks. Read docs/SELF-HOSTING.md. |
| Just evaluating | Zero-config path: `npm install && npm run dev`, paste a public GitHub repo, scan. Mock mode is fully functional — nine deterministic analyzers plus the rubric produce a real, reproducible score; only the LLM-written nuance is absent. Skip every key group; print the matrix. |

## Runtime prerequisites

| tool | min version | probe command | required or optional | fix hint |
| --- | --- | --- | --- | --- |
| node | >= 20 (`engines` in package.json) | `node --version` | required | nodejs.org / nvm |
| npm install + prisma generate | — | `npx prisma -v` after `npm install` (postinstall runs `prisma generate`) | required | `npm install` |
| git | any recent | `git --version` | required | git-scm.com |
| docker | any recent | `docker --version` | conditional: database (only for the Docker Postgres or `--profile app` paths; the PGlite default needs no Docker) | Docker Desktop |
| claude CLI | logged in | `claude --version`, then `claude -p "say ok" --output-format json` | conditional: llm-engine (claude-cli option) and autopilot | `npm i -g @anthropic-ai/claude-code`, then `claude /login` |
| Ollama / local model server | serving an OpenAI-compatible API | `curl http://localhost:11434/v1/models` | conditional: llm-engine (local option) | `ollama pull qwen2.5-coder:14b && ollama serve` |

Preflight everything at once with `npm run doctor` (see Setup helpers) before
asking any question — it is the machine/env doctor pass.

## Capability groups

### llm-engine

- **unlocks**: LLM-calibrated scoring and prose (assessment nuance, briefing narrative) on top of the deterministic analyzers. Provider selection is `LLM_PROVIDER` (`src/lib/llm/index.ts`); default `auto` = Gemini if a key is present → a configured local server → mock.
- **keys**: `LLM_PROVIDER` (auto | gemini | local | claude-cli | openai | openrouter | bedrock | mock), `GEMINI_API_KEY` (alias `GOOGLE_API_KEY`), `LOCAL_LLM_BASE_URL` + `LOCAL_LLM_MODEL` (BOTH required for `local`; optional `LOCAL_LLM_API_KEY`), `CLAUDE_MODEL`/`CLAUDE_CLI_PATH` for claude-cli, `OPENAI_API_KEY`/`OPENAI_BASE_URL`, `OPENROUTER_API_KEY`, `BEDROCK_REGION`/`BEDROCK_MODEL_ID` + AWS creds. Tuning: `LLM_TIMEOUT_MS`, `LLM_FALLBACK_PROVIDER`, `LLM_TEMPERATURE` (default 0 for reproducible scores).
- **options**:
  - Gemini key (fastest hosted path): set `GEMINI_API_KEY` (https://aistudio.google.com/apikey); `auto` picks it up with no other change. Costs per token.
  - Local model server ($0, nothing leaves the box): `LLM_PROVIDER=local` + `LOCAL_LLM_BASE_URL` (Ollama `http://localhost:11434/v1`; LM Studio `:1234/v1`; vLLM `:8000/v1`) + `LOCAL_LLM_MODEL` (the exact tag pulled). Use a 14B-class coder model or better — smaller models under-score the rubric and fall to the deterministic floor.
  - Claude CLI on subscription ($0 extra): `LLM_PROVIDER=claude-cli`; needs the `claude` binary logged in and `ANTHROPIC_API_KEY` UNSET (else it bills per token). Allowed in dev and on self-hosted production builds only — `cliProviderAllowed()` = non-production OR `selfHosted()` (`src/lib/llm/config.ts`). Note: claude-cli has no temperature knob, so its scores are not reproducible.
  - OpenAI / OpenRouter / Bedrock: for compatible gateways, one-key-any-model, or in-AWS-boundary enterprise privacy respectively.
  - Nothing / later.
- **verify**: `LLM_PROVIDER` + its key variables present in the env file; for `local`, `curl $LOCAL_LLM_BASE_URL/models` answers; for claude-cli, the step-1 logged-in smoke passed. (A real scan is the end-to-end proof but spends tokens — offer, don't run unannounced.)
- **without**: `fallback: mock provider — the nine deterministic analyzers still run and the rubric produces a real, reproducible score; you lose only the LLM-written calibration and prose. This is the designed zero-config floor, not an error state.`

### database

- **unlocks**: persistence — scan history, trends, usage metering, recommendation tracking, org dashboards, GitHub App installs.
- **keys**: `DATABASE_URL` (+ `PGLITE_DATA_DIR` for the embedded path; `DSQL_*` for Aurora DSQL production).
- **options**:
  - Embedded PGlite (dev default, zero install): keep `.env.example`'s `PGLITE_DATA_DIR=.pglite/ascent` and the dummy `DATABASE_URL=postgresql://pglite@127.0.0.1:5432/ascent` — `npm run dev` boots Postgres-in-WASM via `src/instrumentation.ts`; the URL is ignored, the adapter provides the connection.
  - Docker Postgres: `docker compose up -d` (db only), then `DATABASE_URL=postgres://ascent:ascent@localhost:5432/ascent`, UNSET `PGLITE_DATA_DIR`, and `npm run db:push`. (`db:push` is for a real Postgres only — on the PGlite path there is no server to reach and it fails; PGlite applies `prisma/init.sql` itself on every boot, docs/SETUP.md §3.)
  - Hosted Postgres / Aurora DSQL: real `DATABASE_URL` (or `DSQL_ENDPOINT` + `DSQL_*`); production path.
- **verify**: `npm run doctor` covers it; or `node scripts/db-smoke.mjs` (read-only smoke).
- **without**: `fallback: public scans run end to end and render their report; persistence is simply off (isDbConfigured() in src/lib/db/client.ts) — no history, no trends, no usage metering, no org features, no GitHub App installs. DB-less and DB-down degrade the same graceful way.`

### github-token

- **unlocks**: higher GitHub API rate limits for public scans, and the PR/governance signals that need API headroom.
- **keys**: `GITHUB_TOKEN` (fine-grained, read-only Contents + Metadata).
- **options**: paste a token / later.
- **verify**: variable present; `npm run doctor` checks shape. (Do not spend a live API call just to verify.)
- **without**: `fallback: public scans still work on GitHub's anonymous API limits — fine for trying it, easy to exhaust on a fleet; when the limit is hit the scan says so explicitly ("Add a GITHUB_TOKEN to raise the limit", src/lib/github/source.ts).`

### github-app

- **unlocks**: private/org repo scanning via short-lived installation tokens, the PR maturity gate (checks + comment), push-triggered rescans, the practice "open starter PR". Requires the database group.
- **keys**: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (raw or base64 PEM), `GITHUB_APP_SLUG`, `GITHUB_APP_WEBHOOK_SECRET`.
- **options**: run the helper script (below) for one-click creation via GitHub's App-Manifest flow / create the App by hand per docs/SETUP.md §2 row D (permissions and webhook events listed there) / later.
- **verify**: `GET /api/app/repos` on the running app — 503 `"GitHub App is not configured"` vs. an authorized answer; `isAppConfigured()` (`src/lib/github/app.ts`) requires APP_ID + PRIVATE_KEY.
- **without**: `hard-required: private/org scanning and the App endpoints refuse loudly — /api/app/* answers 503 naming the missing configuration; webhooks are ignored. Public scans never need it.`
- **helper**: `node --env-file=.env.local scripts/register-github-app.mjs` — serves http://localhost:7799, walks GitHub's manifest flow, and writes ALL app credentials (id, slug, webhook secret, private key) to a temp JSON for you to merge into the env file.

### auth

- **unlocks**: the sign-in wall (Supabase GitHub OAuth) over `/org/*`, private scans, `/connect`, `/usage`, `/trends`.
- **keys**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key is public by design — RLS protects data). Dev escape hatch: `ASCENT_AUTH_BYPASS=1` (hard-disabled in production). The `GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET`/`AUTH_SECRET` stack exists but is DORMANT — configuring only it yields no working login wall (docs/SETUP.md warning).
- **options**: create a Supabase project + enable the GitHub provider (redirect URLs in docs/SETUP.md §1) / later.
- **verify**: `authGateEnabled()` semantics — both NEXT_PUBLIC_SUPABASE_* vars present and bypass off; probe: an `/org/*` page redirects to sign-in.
- **without**: `fallback: the app runs OPEN — no login wall at all (supabaseAuthConfigured() false → authGateEnabled() false, src/lib/env.ts). Correct for a personal/local install; a team-facing deployment should configure it.`

### billing

- **unlocks**: the hosted-cloud commerce path — plan tiers, scan credits, credit-pack checkout via Polar.
- **keys**: `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER` (sandbox|production), `POLAR_CREDIT_PACKS`.
- **options**: configure Polar (steps in `.env.example` tail) — note this flips the deployment into CLOUD mode unless `ASCENT_SELF_HOSTED=1` is set / later (the normal answer).
- **verify**: `polarEnabled()` (`src/lib/polar.ts`); packs appear on the org dashboard.
- **without**: `hidden: self-host is unmetered BY DESIGN — with no POLAR_ACCESS_TOKEN, selfHosted() is true (src/lib/env.ts), every plan gate is open, isMeteredScan() returns false (src/lib/entitlement.ts), and the dashboard simply hides the credit packs. Nothing degrades; do not configure this unless you are selling operation.`

### cron

- **unlocks**: protected scheduled endpoints — autoscans (`/api/cron/rescan`), digests, retention purge — driven by Vercel Cron or any scheduler sending `Authorization: Bearer <CRON_SECRET>`.
- **keys**: `CRON_SECRET` (generate: any long random value, e.g. 32-byte hex — write it, never echo it). Related sinks: `ALERT_WEBHOOK_URL` (Slack-compatible or `mailto:`), `ASCENT_PUBLIC_URL` for absolute links.
- **options**: generate the secret + point a scheduler at the cron routes / later.
- **verify**: variable present; unauthenticated `GET /api/cron/rescan` is rejected.
- **without**: `fallback: nothing scheduled runs on its own — scans happen only when a person (or a webhook) triggers them; alerts are computed and audit-logged but not dispatched without a sink. Fine for a laptop, wrong for an always-on fleet deployment.`

### local-mode

- **unlocks**: the self-hosted local loop — Admin → Pairing tab (map fleet repos to server-filesystem paths), scan-from-disk (`LocalFsSource`, unpushed commits included), instant follow-up close on `Ascent-Resolves:` trailers. See docs/features/local-mode/README.md.
- **keys**: `ASCENT_SELF_HOSTED=1` — EXPLICITLY. The Pairing tab's rail visibility keys on `selfHostedExplicit()` (`src/lib/env.ts`), not the implicit no-billing `selfHosted()` default: merely lacking a Polar token must not grow a server-filesystem control. Feature behavior (routes, gates) keys on `selfHosted()`, so a deliberate deep link on an implicit self-host still works.
- **options**: set the flag and pair repos under Admin → Pairing (verification is read-only: path exists, is a git worktree, has commits) / later.
- **verify**: with the flag set, the Pairing tab appears in the Admin rail; `/api/org/local/pairing` answers instead of the managed-cloud refusal.
- **without**: `hidden: the Pairing tab does not render and the /api/org/local/* routes answer 404 on managed cloud (selfHostGuard, src/lib/api/self-host.ts) — the feature removes itself rather than showing a filesystem-shaped control nobody opted into.`

### autopilot

- **unlocks**: the war room's dispatch loop — a local `claude` session works a paired repo's follow-ups in an isolated worktree (branch `ascent/autopilot-*`, never pushed), and a from-disk rescan closes what its trailers resolved.
- **keys**: `ASCENT_AUTOPILOT=1` (opt-in even on a box you own), `ASCENT_AUTOPILOT_TIMEOUT_MS` (default 20 min). Prerequisites: local-mode group ON, repos paired, claude CLI installed + logged in.
- **options**: enable after local-mode is proven / later (the safe default — this spawns an auto-editing agent).
- **verify**: flag present AND the step-1 claude smoke passed AND at least one repo paired.
- **without**: `hidden: the dispatch control does not appear — autopilot is OFF by default by design (.env.example §autopilot), because spawning an auto-editing agent is a deliberate opt-in.`

## Zero-key path

With nothing configured at all: `npm install && npm run dev`, paste any public
GitHub repo, scan it. The nine deterministic analyzers and the rubric produce a
**real, reproducible score** — mock mode is the designed floor, not a demo. No
database, no signup, no telemetry, nothing phones home (docs/SELF-HOSTING.md
"The shortest path"). What you do not get: LLM prose, persistence/history,
private repos, org features. With the PGlite lines from `.env.example` kept, you
additionally get persistence with zero installs; `npm run db:local:seed` /
`npm run db:seed:fleet` can populate demo fleet data worth looking at.

## Setup helpers

| script | what it does | when to offer |
| --- | --- | --- |
| `npm run doctor` | the machine/env preflight: probes runtime deps and env-file coherence, read-only | first, before any questions, and as the `/onboarding check` core |
| `docker compose up -d` | local Postgres 16 on :5432 (db only; `--profile app` adds the app container) | database group, Docker option |
| `npm run db:push` | applies the Prisma schema to a REAL Postgres (`PGLITE_DATA_DIR` unset) — never on the PGlite path, where it fails and is not needed | after a real DATABASE_URL is set |
| `node --env-file=.env.local scripts/register-github-app.mjs` | one-click GitHub App creation via the manifest flow; writes all credentials to a temp JSON | github-app group |
| `npm run db:local:seed` / `npm run db:seed:fleet` | seed real scans / a demo fleet into the local DB (uses the configured LLM provider — may spend tokens; announce that) | after database group, when the user wants a populated dashboard |
| `node scripts/db-smoke.mjs` | read-only database connectivity smoke | verifying the database group |

## Boot verify

1. Pre-boot gate: `npx tsc --noEmit` (Prisma client must exist — `npm install`'s postinstall generates it; re-run `npm run db:generate` if types are missing).
2. Boot `npm run dev` in the background. Read the real port from Next's startup banner (default :3000, but it moves when the port is taken — never assume).
3. Probe `GET /` on the live port for a 2xx.
4. Per-group probes (read-only): database → `node scripts/db-smoke.mjs`; github-app → `GET /api/app/repos` (503 not-configured vs. auth-gated answer); auth → an `/org/*` page redirects to sign-in; local-mode → Pairing tab present; billing → packs visible (cloud mode only). For llm-engine the honest end-to-end proof is one public scan — it spends tokens on a real provider, so offer it, never run it unannounced.
5. Restart caveat: env changes need a dev-server restart; an old process quietly running old env is the classic false "it works". PGlite runs in-process, so a stale server also holds the data directory lock.

## Env notes

- `NEXT_PUBLIC_*` variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_DEMO_ORG`, `NEXT_PUBLIC_SOURCE_REPO_URL`, `NEXT_PUBLIC_SENTRY_DSN`) are inlined at build time — they cannot reach an already-built client bundle; rebuild (or restart dev) after changing them.
- `GITHUB_APP_PRIVATE_KEY` accepts a raw PEM (literal or `\n`-escaped newlines) or the base64 of the PEM — base64 is the safe shape for env files.
- Secrets worth generating for the user (long random values, never echoed): `CRON_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET`, `PUBLIC_SCAN_QUOTA_SALT`, `AUTH_SECRET` (only for the dormant OAuth stack; `openssl rand -base64 32`).
- The PGlite `DATABASE_URL` is deliberately a dummy — the driver adapter supplies the connection; do not "fix" it to a real URL unless leaving PGlite (then also unset `PGLITE_DATA_DIR`, or the embedded DB keeps winning). PGlite re-applies `prisma/init.sql` with `IF NOT EXISTS` on every boot, so new tables arrive on restart; a new column on an existing table logs `[pglite] SCHEMA DRIFT` — wipe the data dir or `ALTER TABLE` by hand.
- `ANTHROPIC_API_KEY` set alongside claude-cli silently switches the CLI from subscription to per-token API billing — leave it unset for the subscription path.
- Local-mode pairing paths are absolute paths on the SERVER's filesystem (in-container paths under Docker — mount your code); they are entered in the app's Pairing UI, not the env file.
- Dev-only flags hard-disabled in production regardless of value: `ASCENT_AUTH_BYPASS`, `ASCENT_ALLOW_CREDIT_GRANTS`, `ASCENT_REGISTRY_PREVIEW`.

## Matrix rows

| feature | states it can be in | what decides | how to change |
| --- | --- | --- | --- |
| Public scan, deterministic score (zero-key floor) | on | nothing — always works | — |
| LLM-calibrated scoring (llm-engine) | on / degraded (mock floor) | `LLM_PROVIDER` + its key vars | `/onboarding llm-engine` |
| Persistence: history, trends, org dashboards (database) | on / degraded (scan-only, nothing saved) | `DATABASE_URL` (or PGlite pair / DSQL) | `/onboarding database` |
| GitHub API headroom (github-token) | on / degraded (anonymous rate limits) | `GITHUB_TOKEN` | `/onboarding github-token` |
| Private repos, PR gate, push rescans (github-app) | on / off (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` named) | App credentials + database | `/onboarding github-app` |
| Sign-in wall (auth) | on / degraded (app runs open) | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `/onboarding auth` |
| Plans & credits (billing) | on (cloud mode) / hidden (self-host unmetered, by design) | `POLAR_ACCESS_TOKEN` (+ `ASCENT_SELF_HOSTED`) | `/onboarding billing` |
| Autoscans & scheduled digests (cron) | on / degraded (manual-trigger only) | `CRON_SECRET` + a scheduler | `/onboarding cron` |
| Pairing & scan-from-disk (local-mode) | on / hidden (by design on managed cloud) | `ASCENT_SELF_HOSTED=1` explicitly | `/onboarding local-mode` |
| War-room autopilot (autopilot) | on / hidden (opt-in by design) | `ASCENT_AUTOPILOT=1` + claude CLI + pairing | `/onboarding autopilot` |
