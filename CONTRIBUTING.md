# Contributing to Ascent

Thanks for your interest in improving Ascent. This guide covers local setup and the quality bar a
change must clear before it merges.

> **License note:** Ascent is free software under the [GNU AGPL-3.0](./LICENSE). By contributing you
> agree your contributions are licensed under the same terms, and you grant the maintainers a
> perpetual, worldwide, non-exclusive right to also distribute your contribution under other terms
> (this is what lets Ascent Cloud exist alongside the AGPL release without every contributor having
> to be re-contacted). Sign off each commit with `git commit -s` — that is your
> [DCO](https://developercertificate.org/) attestation and the only paperwork required. See
> [README › License](./README.md#license).

## Prerequisites

- **Node.js 20+** and npm
- **Docker** (only if you want the database / org features; the core scanner runs DB-less)

## Setup

```bash
git clone <your-fork-url> && cd ascent
npm install
cp .env.example .env.local       # everything is optional — with no keys, Ascent runs in deterministic "mock" mode
npm run dev                      # http://localhost:3000
```

To work on the persistence / org-intelligence features, start the local Postgres and sync the schema:

```bash
docker compose up -d             # starts the ascent-db Postgres from docker-compose.yml
# set DATABASE_URL=postgres://ascent:ascent@localhost:5432/ascent in .env.local
npm run db:push                  # dev: push the Prisma schema directly
# (production/CI applies committed migrations instead: npm run db:deploy)
```

See [docs/SETUP.md](./docs/SETUP.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full
picture, and [.env.example](./.env.example) for every supported environment variable (LLM providers,
GitHub App, OAuth, DSQL, retention, cost metering).

## Quality gates

Every change must pass all of these locally before you open a PR; they mirror CI:

| Gate | Command | Bar |
|---|---|---|
| Lint | `npm run lint` | 0 errors |
| Types | `npx tsc --noEmit` | 0 errors |
| Unit tests | `npm test` | all green (`vitest run`) |
| E2E (when touching flows/UI) | `npm run test:e2e` | relevant specs green |

Watch mode while developing: `npm run test:watch`. The auth-off seeded-org e2e suite is
`npm run test:e2e:org`.

## Pull request bar

- **Scope:** one focused change per PR; keep diffs reviewable.
- **Tests:** add or update tests for any behavior change. Security-relevant code (auth/authz,
  webhooks, token minting, rate limiting) **must** ship with tests (see `src/lib/authz.test.ts`
  for the tenant-isolation pattern).
- **No regressions to the strengths:** preserve 0 `any` / `@ts-ignore` / empty-catch, the
  empty/loading/error component coverage, and the deterministic `mock` provider as a first-class path.
- **Docs:** update the relevant `docs/**` and `.env.example` when you add a flag, route, or model.
- **Style:** match the surrounding code; comments explain *why*, not *what*.

### Local-first invariants

These are explicit review criteria — a PR that breaks one will be asked to change, however good the
rest of it is:

- Never make a provider mandatory; every external service stays optional.
- Never remove a deterministic fallback — the `mock` provider floor stays a first-class path.
- No hosted-only features; nothing phones home by default.
- If the hosted version is ever better than this repository, that is a bug.

## AI-assisted contributions

AI-assisted PRs are welcome — much of Ascent is built that way. You own what you submit: run the full
gate locally and be able to explain every line. Disclose substantially agent-generated PRs (there's a
checkbox in the PR template). Drive-by bulk agent PRs are closed without review.

## Triage

Ascent is maintained by one person plus agents; issues and PRs are triaged weekly.

## Reporting bugs & vulnerabilities

File functional bugs as GitHub issues. For security issues, **do not** open a public issue; follow
[SECURITY.md](./SECURITY.md).
