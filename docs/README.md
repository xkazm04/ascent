# Ascent — Documentation

> **Ascent** is the maturity index for AI-native engineering. Point it at a GitHub
> repository and it scores how deeply an engineering org has adopted LLM-driven
> development — then tells them exactly how to climb to the next level.

**Hackathon:** AWS Databases × Vercel (1-month build) · **Track:** 2 — Monetizable B2B
(with a B2C free tier as the top-of-funnel).
**Stack:** Next.js 16 + TypeScript + Tailwind v4 on Vercel · LLM analysis (Gemini for
MVP, AWS Bedrock for enterprise) · **Aurora DSQL** for persistence in Phase 2.

## Read in this order

| # | Doc | What's inside |
|---|-----|---------------|
| 1 | [PRD.md](./PRD.md) | Vision, problem, personas, value prop, monetization, track fit |
| 2 | [MATURITY_MODEL.md](./MATURITY_MODEL.md) | The 5 maturity levels, 7 scoring dimensions, criteria/signals, scoring math |
| 3 | [ARCHITECTURE.md](./ARCHITECTURE.md) | MVP (no-DB) + Phase 2 (Aurora DSQL, Bedrock, GitHub App), data model, diagrams |
| 4 | [BACKLOG.md](./BACKLOG.md) | Epics → user stories, prioritization (MoSCoW), estimates |
| 5 | [PLAN.md](./PLAN.md) | Execution plan: this session + the 4-week roadmap, milestones, risks |
| 6 | [HACKATHON.md](./HACKATHON.md) | Submission requirements mapped to deliverables + bonus-points checklist |

For the **implemented product surface** — feature by feature, with file references — see
[features/README.md](./features/README.md). The docs above are the *why* and the *model*;
the features docs are the *what ships today* and *where it lives in the code*.

## TL;DR

Companies spend heavily on AI coding tools but cannot answer *"are we actually
becoming AI-native, or just paying for seats?"* Ascent reads a repository's
structure, configuration, tests, CI/CD, docs, and commit signals, and produces an
objective **AI-Native Maturity Score** (Level 1–5) across 7 weighted dimensions —
with evidence, benchmarks, and a prioritized roadmap of next steps.

- **Free / B2C:** one-time scan of any public repo → score, report, shareable badge.
- **Pro:** private repos (token), PDF export, re-scans, history.
- **Enterprise (B2B):** GitHub App for org-wide private repos, **privacy-preserving
  inference via AWS Bedrock** (code never leaves the AWS boundary, never used for
  training), **audit logs**, **progress tracking over time**, org rollups, SSO.

The MVP ships **without a database** (Next.js route handlers + LLM API only) so we can
iterate on the scoring quality fast. Phase 2 adds **Aurora DSQL** for scan history,
progress trends, audit, and multi-tenant enterprise data.
