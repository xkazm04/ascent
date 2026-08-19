# Ascent Documentation

> **Ascent** is the maturity index for AI-native engineering. Point it at a GitHub
> repository and it scores how deeply an engineering org has adopted LLM-driven
> development, then tells them exactly how to climb to the next level.

**Stack:** Next.js 16 + TypeScript + Tailwind v4 on Vercel · LLM analysis across six
providers (Gemini, Bedrock, OpenAI, OpenRouter, Claude CLI, Mock) · Prisma over
Postgres / Aurora DSQL, with embedded PGlite for local dev.

Ascent began as an AWS Databases × Vercel hackathon build; it has since grown well
past that scope (Supabase auth wall, billing and credits, RBAC, org fleet scanning,
playbooks, passports, a CI gate). Docs from the hackathon period live in
[`archive/2026-hackathon/`](archive/2026-hackathon/).

## Layout

| Path | What's inside |
| --- | --- |
| [`features/`](features/README.md) | **The implemented product surface**, one folder per `context-map.json` group. Start here for "how does X work today, and where is it in the code?" |
| `*.md` (this level) | Cross-cutting docs: the *why*, the *model*, and the operational setup |
| [`archive/`](archive/) | Dated, point-in-time artifacts. Append-only; never edited to look current |
| `harness/` | Gitignored local scan-run output. Not part of the corpus |

## Read in this order

| # | Doc | What's inside |
| --- | --- | --- |
| 1 | [PRD.md](./PRD.md) | Vision, problem, personas, value prop, monetization |
| 2 | [features/scanning/maturity-model.md](./features/scanning/maturity-model.md) | The 5 levels, 9 scoring dimensions, criteria/signals, scoring math |
| 3 | [ARCHITECTURE.md](./ARCHITECTURE.md) | Request flow, deployment, the Aurora DSQL rationale, security posture |
| 4 | [SETUP.md](./SETUP.md) | Local and deployed setup ⚠️ *see caveat below* |
| 4b | [SELF-HOSTING.md](./SELF-HOSTING.md) | **Running Ascent yourself**: deployment modes, choosing a model (incl. local + `$0` paths), Docker, cron, upgrades |
| 5 | [VISION-TRANSITION.md](./VISION-TRANSITION.md) | Where the product is heading, with dated delivery markers |
| 6 | [features/README.md](./features/README.md) | Feature-by-feature reference with file pointers |

**Also here:** [VALUE-CASE.md](./VALUE-CASE.md) (open decisions D28–D32),
[REFERENCE-SCAN-AUDIT.md](./REFERENCE-SCAN-AUDIT.md) (the 10-org validation that
produced them), and [DOC-DRIFT.md](./DOC-DRIFT.md).

## Known documentation caveats

A six-agent audit on 2026-07-28 classified every doc against source:
[DOC-DRIFT.md](./DOC-DRIFT.md) has the full evidence. Two things to know before
you trust a doc here:

- ⚠️ **`SETUP.md`'s sign-in section is wrong.** It documents the custom GitHub
  OAuth (`GITHUB_OAUTH_CLIENT_ID/SECRET`, `AUTH_SECRET`) as the login path. That
  stack is dormant; the active wall is **Supabase GitHub OAuth**
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus
  `ASCENT_AUTH_BYPASS` for dev). Following `SETUP.md` as written produces no
  working sign-in.
- ⚠️ **Treat "Known gaps" sections skeptically.** Several docs assert limitations
  the code has since removed. Each area README in `features/` flags the ones found.

Drift is prevented going forward by the Documentation Sync rule and Stop hook;
see [`AGENTS.md`](../AGENTS.md).

## TL;DR

Companies spend heavily on AI coding tools but cannot answer *"are we actually
becoming AI-native, or just paying for seats?"* Ascent reads a repository's
structure, configuration, tests, CI/CD, docs, and commit signals, and produces an
objective **AI-Native Maturity Score** (Level 1–5) across 9 weighted dimensions,
with evidence, benchmarks, and a prioritized roadmap of next steps.

- **Free / B2C:** scan any public repo → score, report, shareable badge.
- **Pro / Team:** private repos, PDF export, re-scans, history, org rollups.
- **Enterprise:** GitHub App for org-wide private repos, privacy-preserving
  inference via AWS Bedrock or your own model (BYOM), audit logs, white-label.

> Tier capabilities are defined in `src/lib/plans.ts` (`PLAN_FEATURES`), which is
> the source of truth, not this list. SSO is **not** implemented; auth is GitHub
> via Supabase only.
