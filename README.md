# Ascent

**The maturity index for AI-native engineering.** Point Ascent at a GitHub repository
(or a whole org) and it scores how deeply an engineering team has adopted LLM-driven
development, a **5-level maturity ladder** across **9 weighted dimensions**, with the
evidence behind every score and a prioritized roadmap to the next level.

**Open source ([AGPL-3.0](./LICENSE)), and built to run on your own machine.** Any model,
including a local one. No feature gates, no scan limits, no telemetry. There is a hosted
cloud too — it sells operation, not capability.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · Prisma + Postgres (or Aurora
DSQL) · a pluggable LLM layer with seven providers.

> 📚 **Self-hosting guide:** [`docs/SELF-HOSTING.md`](./docs/SELF-HOSTING.md).
> Concept docs (vision, maturity model, architecture) live in [`/docs`](./docs/README.md); the
> **implemented product surface**, feature by feature with file references, is in
> [`/docs/features`](./docs/features/README.md). Build journal in [`blog.md`](./blog.md).

## Quick start

```bash
git clone https://github.com/<you>/ascent && cd ascent
npm install
npm run dev                  # http://localhost:3000
```

Paste a public GitHub repo (e.g. `vercel/next.js`) and scan it. **That is a complete
Ascent** — no key, no database, no signup. With nothing configured it runs in
**deterministic mock mode**, where the nine analyzers do the real work and the rubric
produces a real, reproducible score; you are missing the LLM-written nuance on top, not
the product.

Or bring the whole stack up in one command:

```bash
docker compose --profile app up -d      # app + Postgres → http://localhost:3000
```

### Run it with your own model

The LLM only *calibrates and explains* the deterministic signals — it never invents a
score. Two of these cost nothing per token and keep your source on hardware you control:

| Want | Set |
|---|---|
| **A local model** — Ollama, vLLM, LM Studio. `$0`, nothing leaves the machine. | `LLM_PROVIDER=local` + `LOCAL_LLM_BASE_URL=http://localhost:11434/v1` + `LOCAL_LLM_MODEL=qwen2.5-coder:14b` |
| **Your Claude subscription** — the local `claude` CLI, not per-token API credits. | `LLM_PROVIDER=claude-cli` + `CLAUDE_MODEL=sonnet` |
| Google Gemini | `LLM_PROVIDER=gemini` + `GEMINI_API_KEY` |
| OpenAI / Azure / any compatible endpoint | `LLM_PROVIDER=openai` + `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`) |
| One key, any vendor's model | `LLM_PROVIDER=openrouter` + `OPENROUTER_API_KEY` |
| Inference inside your AWS boundary, never trained on | `LLM_PROVIDER=bedrock` + AWS credentials |
| Nothing at all | *(mock — deterministic, keyless, fully functional)* |

Use a **14B-class coder model or better** for the local path: the assessment is a multi-KB
structured JSON, and a small model tends to score under half the rubric, which drops the
scan to its deterministic floor. Details, including the `auto` resolution ladder:
[`llm-providers.md`](./docs/features/scanning/llm-providers.md).

### Everything else is optional

| Env | Effect |
|---|---|
| `DATABASE_URL` | Turns on **persistence** (history, trends, org rollups, usage, audit). |
| `GITHUB_TOKEN` | Raises GitHub rate limits and unlocks PR + branch-governance signals. |
| GitHub App vars | Private & org-wide repos, PR auto-gate, push re-scans (see below). |
| `CRON_SECRET` | Enables the scheduled autoscan / digest / retention routes. |
| Supabase pair | Puts a GitHub sign-in wall in front of the deployment. |
| `ASCENT_SELF_HOSTED` | `1` forces self-hosted mode; unset means self-hosted unless billing is configured. |

See [`.env.example`](./.env.example) for the full, commented list.

### Self-hosted vs. Ascent Cloud

The same code computes the same scores in both. What differs is who operates it.

| | Self-hosted | Ascent Cloud |
|---|---|---|
| Price | Free, forever | Free tier, then paid |
| Scans | Unlimited | Metered (recovering *our* LLM + infra bill) |
| Features | **All of them** — BYOM, white-label briefings, skills, shared memory, PDF export | Tiered |
| Retention | Your disk, your policy | Per tier |
| Model | Any, including local | Ours, or bring your own |
| You operate | Postgres, the GitHub App, cron, alerts, backups | Nothing |

If you find a capability that is better on the cloud than in this repository, that is a
bug — [open an issue](../../issues).

### DevInspector: click a component, copy its source path

A dev-only overlay for grabbing a component's `src/.../File.tsx:line` and pasting it
straight into an AI coding CLI (Claude Code, etc.). Off by default; never present in
production builds.

```bash
npm run dev:inspect   # dev server with source-location stamping on
```

In the app, press **`;`** (enters keyboard mode) then **`i`** (Inspect) to arm it. Hover
highlights the element under the cursor and pins a `File.tsx:line` chip; **right-click** copies
the call-site path, **Alt+right-click** copies the innermost element, click a HUD row to copy
any enclosing file, and **Esc** exits. A plain `npm run dev` works too, but the HUD will say
source mapping is OFF until you relaunch with `npm run dev:inspect`. A gated Turbopack loader
(`scripts/dev-inspector/`) stamps host JSX with `data-loc` only when `DEV_INSPECT=1`; the overlay
(`src/app/_dev-inspector/`) reads it at runtime. Both are absent from production.

## The maturity model

- **5 levels**: L1 Manual → L2 Assisted → L3 Augmented → L4 Integrated → L5 Autonomous.
- **9 dimensions (D1–D9)**: AI Tooling & Conventions · Automated Testing · CI/CD &
  Delivery · Agentic Workflows · Documentation & Knowledge · Code Quality & Guardrails ·
  Commit & Velocity Signals · AI Process & Harness · Supply Chain & Security.
- **Archetype-aware weighting**: the rubric re-weights for `solo` / `team` / `org` so a
  single-author repo isn't dragged down for lacking org-scale infrastructure.
- **Two axes → a posture quadrant**: *adoption* (D1/D4/D7) × *rigor* (the rest) place a
  repo in **AI-Native**, **Fast & Ungoverned**, **Solid but Manual**, or **Getting Started**.

Full rubric: [`docs/features/scanning/maturity-model.md`](./docs/features/scanning/maturity-model.md) · source of truth:
[`src/lib/maturity/model.ts`](./src/lib/maturity/model.ts).

## How it works

1. **Ingest**: read repo metadata, the full git tree, a budgeted sample of file contents
   (≤32 files), and recent commits over the GitHub API (no clone; no source persisted).
   Optionally folds in PR stats + branch-governance signals when a token is present.
2. **Detect**: 9 deterministic analyzers (`src/lib/analyze`) extract evidence per
   dimension → reproducible signal scores, plus archetype + AI-usage classification.
3. **Score**: the engine (`src/lib/scoring`) sends signals + sampled content to an
   `LLMProvider`; the LLM's per-dimension score is **guardbanded** (±25) to the signal
   score, then blended (60% LLM / 40% deterministic) and rolled up to an overall score,
   maturity level, and the two posture axes. A failed/unusable LLM auto-falls back to mock.
4. **Report**: score ring, level ladder, posture quadrant, dimension radar with inline
   evidence + provenance, contributors, PR signals, and a prioritized roadmap, streamed
   live over Server-Sent Events, plus a shareable SVG badge.

Deep dive: [`docs/features/scanning/scan.md`](./docs/features/scanning/scan.md).

## Features

### Free & public: no signup

Everything here works anonymously, with or without an LLM key, including **running** a scan,
not just reading one.

- **Scan any public repo** → a full, auditable report. No signup. Bounded by a shared burst rate
  limit and a rolling monthly free-scan allowance, not by a login. (Operators who need to wall the
  anonymous funnel on their own deployment can set `ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN=1`;
  private / installed-org scans always require sign-in.)
- **Live streaming report**: determinate progress UI over SSE; score ring, level ladder,
  adoption × rigor posture, dimension radar, per-dimension evidence/gaps with a
  signal→LLM→blended **provenance track**, contributor AI-attribution, PR signals, a
  prioritized roadmap, and LLM-vs-detector discrepancies. ([report.md](./docs/features/reporting/report.md))
- **Shareable maturity badge**: Shields-style SVG (level *or* pass/fail gate mode), cached
  and rate-limited, with a [`/badge`](./src/app/badge/page.tsx) generator that copies
  ready-to-paste Markdown / HTML / AsciiDoc. ([badge.md](./docs/features/billing/badge.md))
- **PR maturity gate**: a published GitHub Action scores a PR head and fails CI if the repo
  falls short of an archetype-aware policy, so teams can **block merges** on AI-native
  maturity. ([gate.md](./docs/features/scanning/gate.md))
- **Onboarding**: scan a *whole public org* (pick → select repos → stream) without
  installing anything; feeds straight into the org dashboard. ([onboarding.md](./docs/features/onboarding/wizard.md))
- **Landing leaderboard**: when persistence is on, the homepage shows a live
  recently-scanned rail and a most-AI-native leaderboard.

### Pro: private repos

Unlocked with a `GITHUB_TOKEN` (or a GitHub App installation) plus `DATABASE_URL`.

- **Private-repo scans**: via a personal token or short-lived App installation tokens.
- **History & trends**: every scan is persisted; the report adds a maturity-over-time
  trend chart and per-dimension sparklines ([`/trends`](./src/app/trends/page.tsx)).
- **"What changed" diff**: compare any two scans ([`/report/compare`](./src/app/report/compare/page.tsx)):
  level/posture transitions, per-dimension deltas, opened/closed gaps, "why it moved".
- **Recommendation tracker**: mark each roadmap item open → in progress → done, persisted
  (degrades to a read-only roadmap without a DB).

### Org & enterprise: GitHub App + persistence

The B2B layer. Requires the GitHub App and `DATABASE_URL`; auth-scoped when OAuth is on.

- **GitHub App**: install on an org to reach private & org-wide repos, mint short-lived
  installation tokens, **auto-gate PRs** (Check Run + sticky comment), and **re-scan on
  push**. ([github-app.md](./docs/features/github/github-app.md))
- **Org intelligence dashboards** ([org-intelligence](./docs/features/org-dashboard/org-intelligence.md)) under `/org/[slug]`:
  - **Overview**: fleet maturity, adoption/rigor, a **Trajectory forecast** (ETA to next
    level), gap analysis, movers, posture distribution, and highest-leverage fleet moves.
  - **Repositories**: repo leaderboard + repo × dimension heatmap.
  - **Contributors**: AI champions, involvement, concentration / bus-factor.
  - **Delivery**: PR signals, branch governance, 12-week fleet commit activity.
  - **Practices**: the Practice Library (below).
  - **Plan**: goals, a what-if **simulator**, initiatives, and the detector calibration
    backlog. ([plan.md](./docs/features/org-planning/plan.md))
  - **Audit**: searchable, keyset-paginated audit trail.
- **Practices**: turn a roadmap insight into a concrete, language-aware starter file and
  **open it as a draft PR** in the target repo (one practice per dimension). ([practices.md](./docs/features/org-dashboard/practices.md))
- **Usage metering**: public (free) vs private (billable) scans, by provider, with a daily
  trend and CSV/JSON export ([`/usage`](./src/app/usage/page.tsx); IDOR-guarded). ([usage.md](./docs/features/billing/usage.md))
- **Regression alerts**: re-scans that demote a repo (or slide it into "ungoverned") post a
  Slack-compatible alert and an audit entry. ([alerts.md](./docs/features/fleet/alerts.md))
- **Scheduled jobs**: cron-driven autoscans of watched repos + retention/purge enforcement.
  ([cron-and-retention.md](./docs/features/fleet/cron-and-retention.md))
- **Private inference via AWS Bedrock**: `LLM_PROVIDER=bedrock` routes code to Claude on
  Bedrock; code never leaves the AWS boundary and is never used for training. ([llm-providers.md](./docs/features/scanning/llm-providers.md))
- **Optional GitHub OAuth**: signs users in to scope private org data and their App
  installations; entirely env-gated (the app works fully anonymous when unset). ([auth.md](./docs/features/github/auth.md))

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

Full request/response shapes and the SSE protocol: [`docs/features/scanning/scan.md`](./docs/features/scanning/scan.md).

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
(`prisma migrate deploy`: apply committed migrations in CI/production), `db:studio`
(browse), `db:generate` (regenerate client). Migrations live in
[`prisma/migrations/`](./prisma/migrations) (baseline `0_init`). Schema: [`prisma/schema.prisma`](./prisma/schema.prisma),
DSQL-safe (`relationMode = "prisma"`, UUID PKs, no FK constraints). See
[`docs/features/data/data-model.md`](./docs/features/data/data-model.md) and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §"Local development & Aurora DSQL".

## Connecting private repos (GitHub App)

Install the Ascent GitHub App to scan **private** repos via short-lived installation
tokens (Ascent stores only derived scores, never source). Visit **`/connect`** →
**Install on GitHub** → pick which repos to **watch** and their autoscan schedule.
Setup + env: [`docs/features/github/setup.md`](./docs/features/github/setup.md) and
[`docs/features/github/github-app.md`](./docs/features/github/github-app.md). Private scans are
attributed to the installing org and counted as billable in [`/usage`](./src/app/usage/page.tsx).

## Layout

```
src/
  app/
    page.tsx                          landing (scroll-snap deck: hero/scan, org, fleet, register, levels, dimensions)
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
    llm/                              provider abstraction (local · claude-cli · gemini · bedrock · openai · openrouter · mock)
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
Since shipped: enforced **org roles (RBAC)**, **Polar billing** + prepaid scan credits on the usage
meter, and **PDF report export**.
Next: a live **Aurora DSQL** cluster (IAM-token auth) and the T1/T2 tracks in
[`docs/GOLDEN-TRIO.md`](./docs/GOLDEN-TRIO.md) (evidence ledger, `.ai` standard + fleet remediation).
Hackathon-era plan: [`docs/archive/2026-hackathon/PLAN.md`](./docs/archive/2026-hackathon/PLAN.md).

## Deploying

### Self-hosted

The container image is the supported path — see [`docs/SELF-HOSTING.md`](./docs/SELF-HOSTING.md)
for the full guide:

```bash
docker compose --profile app up -d      # app + Postgres → http://localhost:3000
```

The image runs as a non-root user, needs **no secrets at build time**, and sets
`ASCENT_SELF_HOSTED=1` so every plan gate is open and scans are unmetered. A plain
`npm run build && npm start` works too; set `ASCENT_SELF_HOSTED=1` alongside it if you want the
`claude-cli` provider (that gate reads it, because `NODE_ENV` is `production` either way).

Cron routes (`/api/cron/*`) are plain HTTP behind `CRON_SECRET`, so any scheduler drives
them — systemd timers, `cron`, a Kubernetes `CronJob`, GitHub Actions.

### Ascent Cloud (Vercel)

The hosted deployment targets **Vercel**. Production requirements:

- **Vercel Pro (or higher).** The scan, org-import, cron and webhook routes set `maxDuration` of
  120–300s (a full scan + LLM scoring, or a bulk org import, runs long). Vercel's Hobby plan caps
  serverless functions at 60s and would truncate them, so Pro is required.
- **Environment:** set the variables you need from [`.env.example`](./.env.example) (LLM provider,
  `DATABASE_URL`/DSQL, GitHub App, OAuth `AUTH_SECRET`). With none set, the app runs keyless in mock
  mode.
- **Migrations:** apply the committed Prisma migrations with `npm run db:deploy`
  (`prisma migrate deploy`), not `db:push`. Baseline is `prisma/migrations/0_init`; an existing DB
  first built with `db push` needs a one-time `prisma migrate resolve --applied 0_init`.
- **Autoscans:** set `CRON_SECRET` (the cron routes fail closed without it) and configure the GitHub
  App. Verify readiness at `GET /api/health` → `autoscan.ready`.

### Deploy & rollback

- **Deploys:** the Vercel Git integration owns deploys: every push to `master` builds and promotes
  to production. There is no manual deploy step.
- **Canonical prod host:** `https://ascent-red.vercel.app` (also the value of `ASCENT_PUBLIC_URL`).
- **Migrations run at build time:** `vercel.json` sets
  `"buildCommand": "npm run db:deploy && npm run build"`, so committed Prisma migrations
  (`prisma migrate deploy`) are applied before every production build. A migration failure fails
  the build: the previous deployment stays live.
- **Rollback:** Vercel dashboard → project → **Deployments** → pick the previous good deployment →
  **Promote to Production** (instant, no rebuild). CLI equivalent: `vercel rollback`. Note:
  rollback restores the code, not the database, since migrations are forward-only.
- **Post-deploy smoke:** `.github/workflows/smoke.yml` runs the `@smoke`-tagged Playwright specs
  against the deployed host after each production deploy.
- **Required prod env:** `ASCENT_PUBLIC_URL` plus the variables documented in
  [`.env.example`](./.env.example) (LLM provider + keys, `DATABASE_URL`, GitHub App set, OAuth
  `AUTH_SECRET`, Supabase pair, `CRON_SECRET`). Set them in the Vercel project; never commit values.

## License

Ascent is free and open-source software under the **GNU Affero General Public License v3.0**
(SPDX `AGPL-3.0-only`): see [`LICENSE`](./LICENSE).

    Copyright (C) 2026 Ascent authors

Run it, read it, modify it, self-host it for any purpose including commercially — for free,
forever, with no feature gates. The one obligation AGPL adds over GPL: if you run a **modified**
version as a network service that other people use, you must offer those users the source of your
modified version (§13). Using unmodified Ascent for your own org triggers nothing.

**Dual licensing.** The maintainers also offer Ascent under commercial terms for organizations that
want to embed or redistribute it without the AGPL's source-sharing obligation — open an issue to
ask. Ascent Cloud (the hosted service) runs this same codebase; you are paying for operation, not
for features.

---

**Contributing:** [`CONTRIBUTING.md`](./CONTRIBUTING.md) · **Security:** [`SECURITY.md`](./SECURITY.md) ·
**Self-hosting:** [`docs/SELF-HOSTING.md`](./docs/SELF-HOSTING.md)

Scored by Ascent
