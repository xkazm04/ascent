# Ascent

**The maturity index for AI-native engineering.** Point Ascent at a GitHub repository
(or a whole org) and it scores how deeply an engineering team has adopted LLM-driven
development — a **5-level maturity ladder** across **9 weighted dimensions**, with the
evidence behind every score and a prioritized roadmap to the next level.

Built for the **AWS Databases × Vercel** hackathon (Track 2 — Monetizable B2B, with a
free B2C tier as the top of the funnel).
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · Vercel · Gemini (public) /
AWS Bedrock (enterprise) / deterministic mock (keyless) · Prisma + **Aurora DSQL**
(Phase 2 persistence).

> 📚 Concept docs (vision, maturity model, architecture) live in [`/docs`](./docs/README.md).
> The **implemented product surface**, feature by feature with file references, is in
> [`/docs/features`](./docs/features/README.md). Build journal in [`blog.md`](./blog.md).

## Quick start

```bash
npm install
cp .env.example .env.local   # optional — everything below has a keyless default
npm run dev                  # http://localhost:3000
```

Then paste a public GitHub repo (e.g. `vercel/next.js`) and scan. With no keys at all,
Ascent runs in **deterministic mock mode** — fully functional for demos and CI.

### Keys are optional

| Env | Effect |
|---|---|
| _(none)_ | **Mock mode** — deterministic rubric scoring from repo signals. Fully demoable. |
| `GEMINI_API_KEY` | **Live mode** — Gemini calibrates the signal scores and writes the roadmap. |
| `GITHUB_TOKEN` | Raises GitHub rate limits and unlocks PR + branch-governance signals. |
| `DATABASE_URL` | Turns on **persistence** (history, trends, org rollups, usage, audit). |
| GitHub App vars | Private & org-wide repos, PR auto-gate, push re-scans (see below). |
| `LLM_PROVIDER=bedrock` | Routes inference through **AWS Bedrock** (Claude) for enterprise privacy. |

See [`.env.example`](./.env.example) for the full, commented list (`GEMINI_MODEL`,
`BEDROCK_MODEL_ID`, OAuth, `CRON_SECRET`, `ALERT_WEBHOOK_URL`, retention, …).

## The maturity model

- **5 levels** — L1 Manual → L2 Assisted → L3 Augmented → L4 Integrated → L5 Autonomous.
- **9 dimensions (D1–D9)** — AI Tooling & Conventions · Automated Testing · CI/CD &
  Delivery · Agentic Workflows · Documentation & Knowledge · Code Quality & Guardrails ·
  Commit & Velocity Signals · AI Process & Harness · Supply Chain & Security.
- **Archetype-aware weighting** — the rubric re-weights for `solo` / `team` / `org` so a
  single-author repo isn't dragged down for lacking org-scale infrastructure.
- **Two axes → a posture quadrant** — *adoption* (D1/D4/D7) × *rigor* (the rest) place a
  repo in **AI-Native**, **Fast & Ungoverned**, **Solid but Manual**, or **Getting Started**.

Full rubric: [`docs/MATURITY_MODEL.md`](./docs/MATURITY_MODEL.md) · source of truth:
[`src/lib/maturity/model.ts`](./src/lib/maturity/model.ts).

## How it works

1. **Ingest** — read repo metadata, the full git tree, a budgeted sample of file contents
   (≤32 files), and recent commits over the GitHub API (no clone; no source persisted).
   Optionally folds in PR stats + branch-governance signals when a token is present.
2. **Detect** — 9 deterministic analyzers (`src/lib/analyze`) extract evidence per
   dimension → reproducible signal scores, plus archetype + AI-usage classification.
3. **Score** — the engine (`src/lib/scoring`) sends signals + sampled content to an
   `LLMProvider`; the LLM's per-dimension score is **guardbanded** (±25) to the signal
   score, then blended (60% LLM / 40% deterministic) and rolled up to an overall score,
   maturity level, and the two posture axes. A failed/unusable LLM auto-falls back to mock.
4. **Report** — score ring, level ladder, posture quadrant, dimension radar with inline
   evidence + provenance, contributors, PR signals, and a prioritized roadmap — streamed
   live over Server-Sent Events, plus a shareable SVG badge.

Deep dive: [`docs/features/scan.md`](./docs/features/scan.md).

## Features

### Free & public — no signup

Everything here works anonymously, with or without an LLM key.

- **Scan any public repo** → a full, auditable report.
- **Live streaming report** — determinate progress UI over SSE; score ring, level ladder,
  adoption × rigor posture, dimension radar, per-dimension evidence/gaps with a
  signal→LLM→blended **provenance track**, contributor AI-attribution, PR signals, a
  prioritized roadmap, and LLM-vs-detector discrepancies. ([report.md](./docs/features/report.md))
- **Shareable maturity badge** — Shields-style SVG (level *or* pass/fail gate mode), cached
  and rate-limited, with a [`/badge`](./src/app/badge/page.tsx) generator that copies
  ready-to-paste Markdown / HTML / AsciiDoc. ([badge.md](./docs/features/badge.md))
- **PR maturity gate** — a published GitHub Action scores a PR head and fails CI if the repo
  falls short of an archetype-aware policy, so teams can **block merges** on AI-native
  maturity. ([gate.md](./docs/features/gate.md))
- **Onboarding** — scan a *whole public org* (pick → select repos → stream) without
  installing anything; feeds straight into the org dashboard. ([onboarding.md](./docs/features/onboarding.md))
- **Landing leaderboard** — when persistence is on, the homepage shows a live
  recently-scanned rail and a most-AI-native leaderboard.

### Pro — private repos

Unlocked with a `GITHUB_TOKEN` (or a GitHub App installation) plus `DATABASE_URL`.

- **Private-repo scans** — via a personal token or short-lived App installation tokens.
- **History & trends** — every scan is persisted; the report adds a maturity-over-time
  trend chart and per-dimension sparklines ([`/trends`](./src/app/trends/page.tsx)).
- **"What changed" diff** — compare any two scans ([`/report/compare`](./src/app/report/compare/page.tsx)):
  level/posture transitions, per-dimension deltas, opened/closed gaps, "why it moved".
- **Recommendation tracker** — mark each roadmap item open → in progress → done, persisted
  (degrades to a read-only roadmap without a DB).

### Org & enterprise — GitHub App + persistence

The B2B layer. Requires the GitHub App and `DATABASE_URL`; auth-scoped when OAuth is on.

- **GitHub App** — install on an org to reach private & org-wide repos, mint short-lived
  installation tokens, **auto-gate PRs** (Check Run + sticky comment), and **re-scan on
  push**. ([github-app.md](./docs/features/github-app.md))
- **Org intelligence dashboards** ([org-intelligence](./docs/features/org-intelligence/README.md)) under `/org/[slug]`:
  - **Overview** — fleet maturity, adoption/rigor, a **Trajectory forecast** (ETA to next
    level), gap analysis, movers, posture distribution, and highest-leverage fleet moves.
  - **Repositories** — repo leaderboard + repo × dimension heatmap.
  - **Contributors** — AI champions, involvement, concentration / bus-factor.
  - **Delivery** — PR signals, branch governance, 12-week fleet commit activity.
  - **Practices** — the Practice Library (below).
  - **Plan** — goals, a what-if **simulator**, initiatives, and the detector calibration
    backlog. ([plan.md](./docs/features/org-intelligence/plan.md))
  - **Audit** — searchable, keyset-paginated audit trail.
- **Practices** — turn a roadmap insight into a concrete, language-aware starter file and
  **open it as a draft PR** in the target repo (one practice per dimension). ([practices.md](./docs/features/practices.md))
- **Usage metering** — public (free) vs private (billable) scans, by provider, with a daily
  trend and CSV/JSON export ([`/usage`](./src/app/usage/page.tsx); IDOR-guarded). ([usage.md](./docs/features/usage.md))
- **Regression alerts** — re-scans that demote a repo (or slide it into "ungoverned") post a
  Slack-compatible alert and an audit entry. ([alerts.md](./docs/features/alerts.md))
- **Scheduled jobs** — cron-driven autoscans of watched repos + retention/purge enforcement.
  ([cron-and-retention.md](./docs/features/cron-and-retention.md))
- **Private inference via AWS Bedrock** — `LLM_PROVIDER=bedrock` routes code to Claude on
  Bedrock; code never leaves the AWS boundary and is never used for training. ([llm-providers.md](./docs/features/llm-providers.md))
- **Optional GitHub OAuth** — signs users in to scope private org data and their App
  installations; entirely env-gated (the app works fully anonymous when unset). ([auth.md](./docs/features/auth.md))

## API

```bash
# Blocking scan (POST or GET ?url=)
curl -s localhost:3000/api/scan -H 'content-type: application/json' \
  -d '{"url":"vercel/next.js"}' | jq '{level, overallScore, posture}'

# Streaming scan (Server-Sent Events: progress + result)
curl -N localhost:3000/api/scan/stream -H 'content-type: application/json' \
  -d '{"url":"facebook/react"}'

# Maturity gate — 200 on pass, 422 on fail (curl --fail / CI branches on status)
curl -s -o /dev/null -w '%{http_code}\n' \
  'localhost:3000/api/gate/vercel/next.js?min_level=L3&no_ungoverned=1'

# SVG badge (level or ?gate=1 pass/fail)
curl -s 'localhost:3000/api/badge/facebook/react?style=flat'
```

With `DATABASE_URL` set, the persistence endpoints come online:

```bash
curl -s 'localhost:3000/api/history?repo=facebook/react'        | jq '.scans[] | {scannedAt,level,overallScore}'
curl -s 'localhost:3000/api/recommendations?repo=facebook/react'| jq '.items[] | {title,status}'
curl -s -X PATCH 'localhost:3000/api/recommendations/<id>' -H 'content-type: application/json' -d '{"status":"done"}'
curl -s 'localhost:3000/api/usage?org=acme&days=30&format=csv'
```

Full request/response shapes and the SSE protocol: [`docs/features/scan.md`](./docs/features/scan.md).

## Persistence (Phase 2)

The MVP runs with **no database**. Turn on persistence by pointing `DATABASE_URL` at
Postgres locally or **Aurora DSQL** in prod:

```bash
docker compose up -d                                   # local Postgres (DSQL-compatible)
export DATABASE_URL=postgres://ascent:ascent@localhost:5432/ascent
npm run db:push                                        # create tables
npm run dev
```

Everything that touches the DB **degrades gracefully** when `DATABASE_URL` is unset.
Scripts: `db:push` (sync schema in dev), `db:migrate` (create a migration), `db:deploy`
(`prisma migrate deploy` — apply committed migrations in CI/production), `db:studio`
(browse), `db:generate` (regenerate client). Migrations live in
[`prisma/migrations/`](./prisma/migrations) (baseline `0_init`). Schema: [`prisma/schema.prisma`](./prisma/schema.prisma)
— DSQL-safe (`relationMode = "prisma"`, UUID PKs, no FK constraints). See
[`docs/features/data-model.md`](./docs/features/data-model.md) and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §"Local development & Aurora DSQL".

## Connecting private repos (GitHub App)

Install the Ascent GitHub App to scan **private** repos via short-lived installation
tokens (Ascent stores only derived scores, never source). Visit **`/connect`** →
**Install on GitHub** → pick which repos to **watch** and their autoscan schedule.
Setup + env: [`docs/GITHUB_APP.md`](./docs/GITHUB_APP.md) and
[`docs/features/github-app.md`](./docs/features/github-app.md). Private scans are
attributed to the installing org and counted as billable in [`/usage`](./src/app/usage/page.tsx).

## Layout

```
src/
  app/
    page.tsx                          landing (scan box, ladder, dimensions, pricing)
    report/…                          report view, permalink, compare
    trends/ · usage/ · connect/       history, metering, App install
    onboarding/ · launch/             org onboarding + fleet star-map
    org/[slug]/…                      org intelligence dashboards (7 tabs)
    api/
      scan · scan/stream              run a scan (blocking + SSE)
      badge · gate                    SVG badge · CI maturity gate
      app/* · auth/*                  GitHub App webhook/setup · OAuth
      org/* · history · recommendations · usage · audit · cron/*
  components/                         Brand, ScanForm, report/*, org/*, connect/*, …
  lib/
    maturity/model.ts                 the rubric: levels, dimensions, weights, posture
    github/                           ingestion, App tokens, governance, write (PRs)
    analyze/                          deterministic detectors D1–D9
    llm/                              provider abstraction (gemini · bedrock · mock · cli)
    scoring/                          prompt · engine · gate · recommendations · orgsim
    db/                               org rollups, usage, retention, installations, plan
    scan.ts                           top-level orchestrator
prisma/schema.prisma                  Phase 2 data model (DSQL-safe)
action.yml · scripts/maturity-gate.mjs  the published CI gate
```

## Roadmap

Phase 2 shipped: DSQL-safe persistence · history + dimension trends · org intelligence
(rollups, forecast, gap analysis, contributors, delivery, practices, planning, audit) ·
GitHub App (private repos, PR auto-gate, push re-scans) · usage metering · regression
alerts · Bedrock enterprise inference · optional GitHub OAuth.
Next: a live **Aurora DSQL** cluster (IAM-token auth), enforced **multi-user org roles**,
**Stripe** billing on the existing usage meter, and **PDF/report export**.
See [`docs/PLAN.md`](./docs/PLAN.md).

## Deploying

Ascent targets **Vercel**. Production requirements:

- **Vercel Pro (or higher).** The scan, org-import, cron and webhook routes set `maxDuration` of
  120–300s (a full scan + LLM scoring, or a bulk org import, runs long). Vercel's Hobby plan caps
  serverless functions at 60s and would truncate them — Pro is required.
- **Environment:** set the variables you need from [`.env.example`](./.env.example) (LLM provider,
  `DATABASE_URL`/DSQL, GitHub App, OAuth `AUTH_SECRET`). With none set, the app runs keyless in mock
  mode.
- **Migrations:** apply the committed Prisma migrations with `npm run db:deploy`
  (`prisma migrate deploy`) — not `db:push`. Baseline is `prisma/migrations/0_init`; an existing DB
  first built with `db push` needs a one-time `prisma migrate resolve --applied 0_init`.
- **Autoscans:** set `CRON_SECRET` (the cron routes fail closed without it) and configure the GitHub
  App. Verify readiness at `GET /api/health` → `autoscan.ready`.

## License

Ascent is source-available under the **Business Source License 1.1** (SPDX `BUSL-1.1`) —
see [`LICENSE`](./LICENSE). You may read, modify, and self-host it, and the published
GitHub Action (`action.yml`) and maturity badge are free to use in your own CI. The one
restriction: you may not offer Ascent to third parties as a competing hosted/managed
repository-maturity service. Each release converts to **Apache-2.0** on its Change Date
(2030-06-08). For other arrangements, open an issue.

---
Scored by Ascent · #H0Hackathon
