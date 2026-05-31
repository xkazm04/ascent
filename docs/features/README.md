# Features

These documents describe the **implemented product surface** of Ascent — the maturity
index for AI-native engineering. They are written for users, developers, and
automation/CI agents that need a stable reference to how each feature actually works.

Ascent points at a GitHub repository (or a whole org), reads its structure, config,
tests, CI/CD, docs, commits, and pull-request signals, and produces an **AI-Native
Maturity Score** (Level 1–5) across **9 weighted dimensions (D1–D9)** — with evidence,
benchmarks, and a prioritized roadmap. The MVP runs **without a database** (Next.js
route handlers + an LLM API); the persistence-backed Phase 2 layers on history,
org rollups, a GitHub App, a PR maturity gate, usage metering, and enterprise inference.

For the *conceptual* model behind the scores (levels, dimensions, scoring math, the
enterprise/Bedrock story), see the top-level docs: [PRD.md](../PRD.md),
[MATURITY_MODEL.md](../MATURITY_MODEL.md), [ARCHITECTURE.md](../ARCHITECTURE.md),
[ORG-INTELLIGENCE.md](../ORG-INTELLIGENCE.md), [ENTERPRISE.md](../ENTERPRISE.md).

## Core scanning

| Area | Docs | Implementation roots |
| --- | --- | --- |
| Scan pipeline (ingest → analyze → score) | [scan.md](scan.md) | `src/app/api/scan`, `src/lib/scan.ts`, `src/lib/analyze`, `src/lib/scoring`, `src/lib/github/source.ts`, `src/lib/cache.ts`, `src/lib/scan-cache.ts` |
| LLM providers (Gemini / Bedrock / mock / CLI) | [llm-providers.md](llm-providers.md) | `src/lib/llm` |
| Report & visualization | [report.md](report.md) | `src/app/report`, `src/components/report`, `src/lib/report`, `src/app/api/history`, `src/app/api/recommendations` |
| Maturity badge (SVG) | [badge.md](badge.md) | `src/app/api/badge`, `src/app/badge`, `src/components/badge` |

## CI & GitHub integration

| Area | Docs | Implementation roots |
| --- | --- | --- |
| PR maturity gate (GitHub Action + check + comment) | [gate.md](gate.md) | `src/app/api/gate`, `action.yml`, `scripts/maturity-gate.mjs`, `src/lib/scoring/gate.ts`, `src/lib/scoring/gate-comment.ts`, `src/lib/github/checks.ts`, `.github/workflows/maturity.yml` |
| GitHub App (install, webhook, private repos) | [github-app.md](github-app.md) | `src/app/api/app`, `src/lib/github/app.ts`, `src/lib/github/governance.ts`, `src/lib/db/installations.ts`, `src/app/connect`, `src/components/connect` |
| Practices (scaffold a best practice as a PR) | [practices.md](practices.md) | `src/lib/practices.ts`, `src/lib/practice-artifact.ts`, `src/app/api/practices`, `src/lib/github/write.ts`, `src/components/org/PracticeApply.tsx` |

## Organization intelligence (Phase 2)

| Area | Docs | Implementation roots |
| --- | --- | --- |
| Org dashboards, planning, simulator | [org-intelligence/README.md](org-intelligence/README.md), [org-intelligence/plan.md](org-intelligence/plan.md) | `src/app/org`, `src/components/org`, `src/app/api/org`, `src/lib/db/org.ts`, `src/lib/db/plan.ts`, `src/lib/scoring/orgsim.ts`, `src/lib/maturity/forecast.ts` |

## Platform

| Area | Docs | Implementation roots |
| --- | --- | --- |
| Auth (optional GitHub OAuth sessions) | [auth.md](auth.md) | `src/lib/auth.ts`, `src/app/api/auth`, `src/components/GitHubSignInButton.tsx`, `src/components/SignInNotice.tsx` |
| Onboarding & launch | [onboarding.md](onboarding.md) | `src/app/onboarding`, `src/app/launch`, `src/components/onboarding`, `src/components/launch` |
| Usage metering | [usage.md](usage.md) | `src/app/usage`, `src/app/api/usage`, `src/lib/db/usage.ts`, `src/components/usage` |
| Regression alerts | [alerts.md](alerts.md) | `src/lib/alerts.ts`, `src/lib/scan-alerts.ts` |
| Cron jobs & data retention | [cron-and-retention.md](cron-and-retention.md) | `src/app/api/cron`, `src/lib/db/retention.ts` |
| Persistence / data model | [data-model.md](data-model.md) | `prisma/schema.prisma`, `src/lib/db` |

## Maintenance notes

- Each feature doc should name the **UI entry point**, the **primary user flows**, the
  **backend / API surface**, the **data / storage model**, and **known limitations**.
- Long, future-looking narrative belongs in the top-level `docs/*.md` concept files, not
  here. Feature docs keep only a short **Known gaps** section.
- Everything that touches the database degrades gracefully when `DATABASE_URL` is unset
  (DB-less MVP mode). State that explicitly where a feature is DB-gated.
- Auth is **optional and env-gated** (`isAuthConfigured()`); features that read sessions
  must work both signed-in and anonymous. State which behavior is gated.
- This is **Next.js 16** (App Router, async route `params`, Turbopack). Read
  `node_modules/next/dist/docs/` before changing route conventions — see `AGENTS.md`.
