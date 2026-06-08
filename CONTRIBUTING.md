# Contributing to Ascent

Thanks for your interest in improving Ascent. This guide covers local setup and the quality bar a
change must clear before it merges.

> **License note:** Ascent is source-available under the [Business Source License 1.1](./LICENSE).
> By contributing you agree your contributions are licensed under the same terms. See
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

Every change must pass all of these locally before you open a PR — they mirror CI:

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
  webhooks, token minting, rate limiting) **must** ship with tests — see `src/lib/authz.test.ts`
  for the tenant-isolation pattern.
- **No regressions to the strengths:** preserve 0 `any` / `@ts-ignore` / empty-catch, the
  empty/loading/error component coverage, and the deterministic `mock` provider as a first-class path.
- **Docs:** update the relevant `docs/**` and `.env.example` when you add a flag, route, or model.
- **Style:** match the surrounding code; comments explain *why*, not *what*.

## Reporting bugs & vulnerabilities

File functional bugs as GitHub issues. For security issues, **do not** open a public issue — follow
[SECURITY.md](./SECURITY.md).
