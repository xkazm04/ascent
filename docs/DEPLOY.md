# Deploying Ascent Cloud (Vercel)

This page is the operator's runbook for the **hosted** deployment. Self-hosting is a different
document: [`SELF-HOSTING.md`](./SELF-HOSTING.md) (Docker image, plain `npm start`, cron, upgrades).
The two run the same code and compute the same scores; what differs is who operates it.

## Delivery contract

Direct-push-to-master **is** the delivery topology: the push is the release act. There is no PR
queue or merge gate in front of production, so the full blocking gate is `npm run verify`
(lint → typecheck → tests+coverage → build), enforced **before** the push by
[`.githooks/pre-push`](../.githooks/pre-push) on any push updating `refs/heads/master`
(wired via `core.hooksPath`, set by the `prepare` script on `npm install`). The escape hatch is
`ASCENT_SKIP_GATE=1 git push` — emergencies only, and the reason must be recorded (commit message
or a note here). A red `master` is an **outage**: fix it before the next feature. After every
master push, run `gh run watch --exit-status` and follow CI to its verdict.

**The race.** Vercel's Git integration builds and ships every push to `master` **regardless of
CI's verdict** — CI is a scoreboard, not a gate. The compensation is the pre-push gate above: the
gate moves ahead of the push, so the only thing Vercel can ship is a commit that already passed
CI's blocking set locally. Keep local `verify` equal to CI's blocking set whenever either changes
(the lockstep comment lives in [`ci.yml`](../.github/workflows/ci.yml)).

**Build parity warning.** [`vercel.json`](../vercel.json)'s `buildCommand` is
`npm run db:deploy && npm run build`, but CI (and `verify`) run only `build` — **CI never executes
the command that builds production** (the build-time `prisma migrate deploy` is untested there).
Mitigation: a failed Vercel build leaves the previous deployment live. Owed fix: run the full
chain in CI against a disposable database, or move the migration out of `buildCommand`.

**Node authority.** `package.json` pins `"engines": { "node": "24.x" }` so Vercel's runtime major
is pinned by the repo — with a loose `>=20`, Vercel picks the major itself. `.nvmrc` (24) and CI's
`node-version` derive from it; bump all three together. Field note (2026-08-27): the Vercel
project had been building production on 24.x for two months while the repo said 20 everywhere
— a live parity divergence. 24 is the version production actually ran and the local gate proved
green on, so the repo was aligned to it rather than forcing Vercel back to an end-of-life 20.

**Rollback.** `vercel rollback`, or promote the previous good deployment from the Vercel
dashboard (instant, no rebuild). Code only: Prisma migrations are forward-only and are **not**
rolled back. Details under [Deploy & rollback](#deploy--rollback) below.

**Known-broken, owed.** [`smoke.yml`](../.github/workflows/smoke.yml) (the post-deploy `@smoke`
Playwright run) has **never executed**: every run skips because its `deployment_status` guard
never sees `state == 'success'` at event time. The fix is polling the deployment to a terminal
state (or probing the host from CI after the deploy) — documented here as an owed item; the
trigger has deliberately not been patched yet.

**Vercel CLI re-linking.** `.vercel/` is absent/gitignored, so a fresh clone cannot CLI-deploy or
`vercel rollback` until linked: run `vercel link` (interactive, after `vercel login`), or export
`VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` (identifiers, not secrets; linked 2026-08-27):

- `VERCEL_ORG_ID`: `team_x2mjBAxi3mgsZkKQ1SJgkjqL`
- `VERCEL_PROJECT_ID`: `prj_enoDciZF5ewfLRjGIqnaqdASyEL0`

Env inventory (`vercel env ls`, 2026-08-27): 17 variables, every one scoped Preview + Production
— so previews build with the same variable set as production (with the same values, which is the
next thing to split: a preview should hold scoped, lower-privilege values).

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

## Gate bypasses, and why

`ASCENT_SKIP_GATE=1 git push` exists for the case where `npm run verify` is red for a reason the
push does not introduce. It is not a shortcut: every use is recorded here, with the evidence that
made it honest.

### 2026-09-05 — Knowledge base rebuild

Pushed 12 commits (`80294734..6deba68e`) with the gate skipped. Two test files were failing, both
**already failing at `origin/master` with this work absent** — verified by checking the remote tip
out into a scratch worktree and running the two files there, where they fail identically. With those
two excluded the suite is green: 852 files, 11,411 tests. `tsc --noEmit` clean; doc-sync 357/357.

Both are Windows-only and would look green on a LF checkout or on CI, which is why they landed:

| File | Why it fails here |
| --- | --- |
| `src/features/bought/teams/TeamsHonesty.dom.test.tsx` | A source-reading guard matches a regex containing `\n` against `TeamsRollupPanel.tsx` read from disk. With `core.autocrlf=true` the checkout is CRLF, so the pattern cannot match. The fix is to normalize line endings in the READ; the guard's claim is correct and must not be weakened. |
| `src/lib/scoring/gate-cli.test.ts` | Imports `scripts/maturity-gate.mjs`, whose first line is a shebang. `node --check` and a direct `import()` of that script both succeed, so the fault is in vitest's transform of a shebang module, not the script. Landed by `040f73c6`. |

Neither file belongs to the change that was pushed, and neither was edited to make the gate pass —
editing a guard to silence it is the one thing this project does not do.
