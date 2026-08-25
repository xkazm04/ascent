# Deploying Ascent Cloud (Vercel)

This page is the operator's runbook for the **hosted** deployment. Self-hosting is a different
document: [`SELF-HOSTING.md`](./SELF-HOSTING.md) (Docker image, plain `npm start`, cron, upgrades).
The two run the same code and compute the same scores; what differs is who operates it.

## Production requirements

The hosted deployment targets **Vercel**:

- **Vercel Pro (or higher).** The scan, org-import, cron and webhook routes set `maxDuration` of
  120–300s (a full scan + LLM scoring, or a bulk org import, runs long). Vercel's Hobby plan caps
  serverless functions at 60s and would truncate them, so Pro is required.
- **Environment:** set the variables you need from [`.env.example`](../.env.example) (LLM provider,
  `DATABASE_URL`/DSQL, GitHub App, OAuth `AUTH_SECRET`). With none set, the app runs keyless in mock
  mode.
- **Migrations:** apply the committed Prisma migrations with `npm run db:deploy`
  (`prisma migrate deploy`), not `db:push`. Baseline is `prisma/migrations/0_init`; an existing DB
  first built with `db push` needs a one-time `prisma migrate resolve --applied 0_init`.
- **Autoscans:** set `CRON_SECRET` (the cron routes fail closed without it) and configure the GitHub
  App. Verify readiness at `GET /api/health` → `autoscan.ready`.

## Deploy & rollback

- **Deploys:** the Vercel Git integration owns deploys: every push to `master` builds and promotes
  to production. There is no manual deploy step.
- **Canonical prod host:** `https://ascent-red.vercel.app` (also the value of `ASCENT_PUBLIC_URL`).
- **Migrations run at build time:** [`vercel.json`](../vercel.json) sets
  `"buildCommand": "npm run db:deploy && npm run build"`, so committed Prisma migrations
  (`prisma migrate deploy`) are applied before every production build. A migration failure fails
  the build: the previous deployment stays live.
- **Rollback:** Vercel dashboard → project → **Deployments** → pick the previous good deployment →
  **Promote to Production** (instant, no rebuild). CLI equivalent: `vercel rollback`. Note:
  rollback restores the code, not the database, since migrations are forward-only.
- **Post-deploy smoke:** [`.github/workflows/smoke.yml`](../.github/workflows/smoke.yml) runs the
  `@smoke`-tagged Playwright specs against the deployed host after each production deploy.
- **Required prod env:** `ASCENT_PUBLIC_URL` plus the variables documented in
  [`.env.example`](../.env.example) (LLM provider + keys, `DATABASE_URL`, GitHub App set, OAuth
  `AUTH_SECRET`, Supabase pair, `CRON_SECRET`). Set them in the Vercel project; never commit values.

## Database

Production uses **Aurora DSQL** (IAM-token auth, short-lived tokens, OCC retries); the connection
factory and the serialization-conflict retry are described in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §4 "Deployment". The schema is DSQL-safe
(`relationMode = "prisma"`, UUID PKs, no FK constraints), so the same migrations apply to plain
Postgres and to DSQL: [`features/data/data-model.md`](./features/data/data-model.md).

## Connecting the external services

Every URL a GitHub App or Supabase project must point at, and the env var each one yields, is the
table in [`SETUP.md`](./SETUP.md) §1–2. After the first deploy, re-point the App and Supabase URLs
from `localhost` to the Vercel `{host}`.
