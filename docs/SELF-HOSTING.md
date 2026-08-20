# Self-hosting Ascent

Ascent is [AGPL-3.0](../LICENSE) software. Run it on your own machine or your own cluster, for any
purpose including commercially, with **no feature gates, no scan limits, and no telemetry**. The
hosted cloud sells operation — a managed database, the GitHub App, cron, alerting, support — not
capability.

This page is the operator's guide. For the architecture behind what you are running, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md); for every environment variable,
[`.env.example`](../.env.example).

---

## The shortest path

```bash
git clone https://github.com/<you>/ascent && cd ascent
npm install
npm run dev            # http://localhost:3000
```

That is a complete, working Ascent. Paste a public GitHub repo and scan it. With nothing configured
it runs in **mock mode**: the nine deterministic analyzers do the real work and the rubric produces a
real, reproducible score — you are missing only the LLM-written nuance on top, not the product.

Nothing here phones home. No key is required to start.

---

## Deployment modes

Ascent decides at runtime whether it is a self-hosted deployment or the hosted product, because that
decides whether plan tiers and scan credits are enforced at all.

| `ASCENT_SELF_HOSTED` | Meaning |
| --- | --- |
| unset (default) | Self-hosted **unless** `POLAR_ACCESS_TOKEN` is configured. A deployment that sells nothing does not meter. |
| `1` / `true` | Force self-hosted. |
| `0` / `false` | Force cloud mode: enforce plan tiers and scan credits. |

In self-hosted mode (`selfHosted()`, [`src/lib/env.ts`](../src/lib/env.ts)):

- every plan gate is open — bring-your-own-model, white-label briefings, the skills library, shared
  org memory, PDF export;
- scans are **unmetered**: no monthly allowance, no credit ledger, no `402`;
- scan history has **no retention floor** — it is your disk and your policy;
- the `claude-cli` provider is permitted in a production build.

The container image sets `ASCENT_SELF_HOSTED=1` for you.

---

## Choosing a model

The scoring step calls an LLM only to *calibrate and explain* the deterministic signals — it never
invents a score from nothing. Any of these work; two of them cost nothing per token and keep your
source on hardware you control.

### Local model (Ollama, vLLM, LM Studio) — `$0`, nothing leaves the machine

```bash
ollama pull qwen2.5-coder:14b
ollama serve
```

```bash
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://localhost:11434/v1   # LM Studio :1234/v1 · vLLM :8000/v1
LOCAL_LLM_MODEL=qwen2.5-coder:14b
```

Both variables are required and neither is guessed — ports differ per runtime, and an invented model
default would 404 on a machine that never pulled it.

**Use a 14B-class coder model or better.** The assessment is a multi-KB structured JSON, not a chat
reply. A small model routinely scores fewer than half the rubric's nine dimensions, at which point
the scan falls back to its deterministic floor; the log line naming the model and the coverage
(`scored only 3/9 dimensions`) is the signal to size up.

### Claude CLI — `$0` extra if you already pay for Claude

```bash
LLM_PROVIDER=claude-cli
CLAUDE_MODEL=sonnet
```

Runs the locally-installed `claude` binary under your Pro/Max **subscription** rather than
per-token API credits (`ANTHROPIC_API_KEY` is stripped from the child environment). Requires
`claude` on `PATH` and logged in (`claude /login`). A full CLI session is ~6 minutes median, so
`CLAUDE_CLI_TIMEOUT_MS` defaults to 10 minutes.

This provider needs self-hosted mode in a production build — the image sets it; a manual
`npm run build && npm start` needs `ASCENT_SELF_HOSTED=1`.

### Hosted APIs

`gemini` (`GEMINI_API_KEY`), `openai` (`OPENAI_API_KEY`, plus `OPENAI_BASE_URL` for Azure or any
compatible endpoint), `openrouter` (`OPENROUTER_API_KEY`, one key for any vendor's model), or
`bedrock` (AWS credentials; inference stays inside your AWS boundary and is never trained on).

Full details, including the `auto` resolution ladder and the JSON-decoding fallbacks:
[`docs/features/scanning/llm-providers.md`](./features/scanning/llm-providers.md).

---

## Persistence

The scanner runs with no database at all. Turn on history, trends, org dashboards, usage and audit by
pointing `DATABASE_URL` at any Postgres:

```bash
docker compose up -d                                    # local Postgres on :5432
export DATABASE_URL=postgres://ascent:ascent@localhost:5432/ascent
npm run db:deploy                                       # apply committed migrations
npm run dev
```

Use `npm run db:deploy` (`prisma migrate deploy`) for anything you intend to keep; `npm run db:push`
is the dev-loop shortcut that syncs the schema without a migration history. Every feature that
touches the database degrades cleanly when `DATABASE_URL` is unset.

The schema is written to stay inside Aurora DSQL's supported subset (UUID primary keys, no foreign
key constraints, `relationMode = "prisma"`), so the same migrations apply to plain Postgres and to
DSQL. See [`docs/features/data/data-model.md`](./features/data/data-model.md).

---

## Docker

```bash
docker compose --profile app up -d      # app + Postgres → http://localhost:3000
```

`docker compose up -d` without the profile still starts **only** Postgres, which is the contributor
dev loop (`npm run dev` against it) — the app service is profile-gated so that flow is unchanged.

The image is a three-stage build: dependencies, build, then a runtime stage that carries neither the
toolchain nor the dev dependencies and runs as the non-root `node` user. It sets
`ASCENT_DOCKER_BUILD=1`, which is the only thing that flips
[`next.config.ts`](../next.config.ts) to `output: "standalone"` — Vercel does its own tracing, so
that mode is a container concern and must not change how cloud deploys are packaged.

**The build needs no secrets.** Every integration degrades to a no-op when its environment is
absent, so an image built with nothing configured is a working image; you supply configuration at
run time.

To reach a model running on the host (Ollama, typically) from inside the container, use
`host.docker.internal` — the compose file maps it on Linux too:

```yaml
LLM_PROVIDER: local
LOCAL_LLM_BASE_URL: http://host.docker.internal:11434/v1
LOCAL_LLM_MODEL: qwen2.5-coder:14b
```

Apply migrations against the compose database with:

```bash
docker compose exec app npx prisma migrate deploy
```

---

## Optional: the GitHub App

Scanning **public** repos needs nothing. Private and org-wide repos, PR auto-gating and re-scan-on-push
need a GitHub App, and on a self-hosted deployment you register your own — it takes a few minutes and
is the one piece of setup the hosted cloud genuinely saves you.

Walkthrough: [`docs/features/github/setup.md`](./features/github/setup.md).

A `GITHUB_TOKEN` alone (a classic or fine-grained PAT) is a lighter alternative: it raises rate
limits and unlocks the PR and branch-governance signals without an App installation.

---

## Optional: scheduled work

Autoscans of watched repos, the weekly digest, and retention purges are plain HTTP routes under
`/api/cron/*`, authenticated with `CRON_SECRET`. Any scheduler works — systemd timers, `cron`,
Kubernetes `CronJob`, GitHub Actions:

```bash
curl -fsS -H "authorization: Bearer $CRON_SECRET" https://ascent.internal/api/cron/rescan
```

The routes **fail closed** without `CRON_SECRET`. Check wiring at `GET /api/health` →
`autoscan.ready`.

---

## Sign-in

Ascent runs fully anonymous by default, which is usually what you want on a trusted network. To put
a login wall in front of it, configure Supabase GitHub OAuth
(`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`); see
[`docs/features/github/auth.md`](./features/github/auth.md). `ASCENT_AUTH_BYPASS` drops the wall in
development and is hard-disabled in production builds, so it can never be the reason a real
deployment is open.

---

## Upgrading

```bash
git pull
npm install
npm run db:deploy     # only if you run with a database
npm run build
```

Migrations are forward-only. Read [`CHANGELOG.md`](../CHANGELOG.md) before a major jump.

---

## What the cloud does that this does not

Stated plainly, so the trade is legible:

- **Operation.** A managed Postgres, a registered GitHub App, cron that already runs, alert delivery,
  backups, and someone on call for all of it.
- **Onboarding.** Sign in with GitHub, pick an org, get a scored fleet — no App registration, no
  provider key, no database.
- **Support and SLAs**, SSO/SAML, and VPC or on-premises deployment arrangements, on the Custom tier.

Everything a self-hosted Ascent *computes* is identical: same rubric, same analyzers, same scoring
engine, same dashboards. If you find a capability that is better on the cloud than in this
repository, that is a bug — please open an issue.
