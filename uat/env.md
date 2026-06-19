# Environment recipe — reaching a known, reproducible start state

Everything downstream depends on a *reproducible* start state. Pin this before trusting any run.

## App + server
- Start: `npm run dev` (Next.js 16, http://localhost:3000). Reuse an already-running dev server; don't spawn a second.
- UI language: **English**. Drive with English role-based selectors.
- Health check: `GET /api/health` (poll for 200 before driving).
- Wedged-server recovery (after a `git checkout` swaps files, or a Turbopack cache error): kill the port, delete `.next/`, restart, re-poll.

## LLM provider (for the *app's* own scoring, not the UAT driver) — RESOLVED: Claude Code CLI
- **UAT default: `LLM_PROVIDER=claude-cli`** (pinned in `.env.local`). The app's own scoring shells out to the local `claude` CLI in headless mode (`src/lib/llm/claude-cli.ts`), running under your **Claude Pro/Max subscription** (not pay-per-token — the provider deletes `ANTHROPIC_API_KEY` from the child env). Requires `claude` on PATH + logged in (`claude /login`). This is so **every LLM test reflects real Claude output**, not the deterministic floor — which is what makes the **senior-quality** dimension meaningful. `LLM_FALLBACK_PROVIDER=mock` is set so a CLI hiccup (not logged in / rate-limited) degrades gracefully instead of failing a sweep.
- **Budget for latency**: a claude-cli scan calls the model once over sampled file content — typically tens of seconds, up to ~5–10 min on a large repo (`CLAUDE_CLI_TIMEOUT_MS`, default 150s; the seeders allow longer). The page streams progress over SSE; an early client-timeout would itself be a finding.
- Other modes if you need them: `mock` (deterministic, keyless — cheapest, fine for pure-structural L1), `gemini` (+`GEMINI_API_KEY`), `bedrock` (enterprise-privacy path Elena cares about).
- Note: the **UAT Character driver is a separate capable LLM** driving the browser — it does not collide with the app's claude-cli provider.

## Data / persistence / seed
- **No DB needed for the public funnel.** Single-repo scan, report, badge, gate all work with `DATABASE_URL` unset — every db helper is a safe no-op.
- **Authed/org features need persistence** (history, trends, org rollups, usage, audit). Easiest local path is the **embedded in-process PGlite** (Postgres-in-WASM, no install, no separate server):
  ```
  PGLITE_DATA_DIR=.pglite/ascent
  DATABASE_URL=postgresql://pglite@127.0.0.1:5432/ascent   # dummy URL; PGlite adapter provides the real connection
  npm run dev            # src/instrumentation.ts boots PGlite and persists to PGLITE_DATA_DIR (port 3000)
  ```
- **Two seeders (both drive the RUNNING dev server's real API path, so start `npm run dev` first):**
  - `node scripts/seed-org.mjs <org> [count]` → **the org dashboard.** Scans a public org's repos via POST `/api/org/import`; the dashboard then lives at **`/org/<org>`** (the slug is just the GitHub org login). Default = mock LLM (fast); `--live` uses the real provider. Example: `node scripts/seed-org.mjs vercel 20` → visit **`/org/vercel`**. This is the seed for the `/org/[slug]` journeys (Dana, Marcus, Priya, Raj, Nadia). `node scripts/seed-org-extras.mjs <org>` adds members/teams/segments for those facets. Defaults to base `http://localhost:3000`.
  - `npm run db:local:seed` (= `node scripts/seed-scans.mjs [baseUrl] [repo…]`) → **individual repo scans + history/trends** (default set: anthropics/claude-code, vercel/swr, prisma/prisma, tailwindlabs/tailwindcss, vercel/turbo). ⚠️ Its default baseUrl is `http://localhost:3001` — pass `http://localhost:3000` explicitly if your dev server is on 3000. Set `LLM_PROVIDER=claude-cli` for subscription-quality (not mock) data; expect 5–10 min/repo on a live provider.
- Public scan target for journeys: paste a real public repo (e.g. `vercel/next.js`, `facebook/react`). A `GITHUB_TOKEN` raises rate limits and unlocks PR + branch-governance signals; without it, public scans still run (lower rate limit).

## Auth — RESOLVED: bypassed, but backed by a real local profile
The active login is **Supabase GitHub OAuth**; org/private features sit behind it. Characters do **not** log in — auth is bypassed — but they operate on a *genuine* local profile + data, not a hollow open gate:
- **`ASCENT_AUTH_BYPASS=1`** — every auth gate passes as a synthetic "developer" viewer, so all `/org/*` and private functionality is reachable with no Supabase project and no GitHub sign-in (hard-gated off in production; `src/lib/access.ts`).
- **`ASCENT_OPEN_ORG_DASHBOARDS=1`** — open seeded org dashboard (`/org/<slug>`) reads when OAuth is not configured.
- **Local profile auto-seed (new):** visiting a *populated* `/org/<slug>` under the bypass persists "developer" as a real **owner `Membership`** (+ `User`) in PGlite — see `src/app/org/[slug]/layout.tsx`. So the **production schema** (`prisma/init.sql`, the same models the cloud runs) holds a real profile the Characters act as: the **Members** tab lists them, the role chip shows **owner**, and RBAC-gated surfaces resolve a real role. Idempotent, best-effort, dev-only (can't seed ghost owners in prod). The row appears on the **second** visit (first visit seeds it).
- Local-credit/dev seams for billing-gated paths: `ASCENT_ALLOW_CREDIT_GRANTS=1` (manual scan-credit grants), `POLAR_SERVER=sandbox` for the Polar buy-credits flow.

All of the above (plus `LLM_PROVIDER=claude-cli` and `SUPPLY_CHAIN_PROVIDER=mock`) are pinned in **`.env.local`** (git-ignored). Full-coverage recipe:
```
npm run dev                              # boots in-process PGlite + reads .env.local (port 3000)
node scripts/seed-org.mjs vercel 12      # seed an org → /org/vercel  (add --live to use claude-cli)
# then open http://localhost:3000/org/vercel  (twice: the first visit seeds the developer profile)
```

## Surfaces

### Public (free funnel — no auth)
`/` (landing + ScanForm) · `/launch` (fleet-map experience) · `/about` · `/pricing` · `/badge` (badge generator) ·
`/report` + `/report/[owner]/[repo]` (report) · `/report/compare` (diff two scans) · `/trends` (history) ·
`/onboarding` (scan a whole public org) · `/connect` (pick watched repos) ·
share/invite links: `/live/shared/[token]`, `/share/briefing/[token]`, `/invite/[token]`

### Authed product (`/org` + `/org/[slug]/*`) — reachable via the bypass above
`/org` (org picker) · `/org/[slug]` (overview: fleet maturity, adoption×rigor, trajectory forecast, gap, movers) ·
`/repositories` · `/contributors` · `/delivery` · `/practices` · `/plan` · `/governance` · `/security` · `/adoption` ·
`/teams` · `/segments` · `/members` · `/audit` · `/executive` · `/live` · `/backlog` · `/usage` (metering; IDOR-guarded)

## Driver mechanism
- Prefer an interactive browser MCP (chrome-devtools / playwright) if connected.
- Else the bundled portable driver: `MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3000 SHOT_DIR=uat/runs/<id>/shots node uat/driver/drive.mjs /pricing pricing` (navigate → screenshot + ARIA + text + optional one click). For multi-step flows (paste repo → submit → watch SSE → read report) write a short bespoke driver reusing its patterns; budget for the streaming scan to take time.
