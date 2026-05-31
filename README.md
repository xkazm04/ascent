# Ascent

**The maturity index for AI-native engineering.** Point Ascent at a GitHub repository
and it scores how deeply an engineering org has adopted LLM-driven development — a
5-level maturity ladder across 7 weighted dimensions, with evidence behind every score
and a prioritized roadmap to the next level.

Built for the **AWS Databases × Vercel** hackathon (Track 2 — Monetizable B2B).
**Stack:** Next.js 16 · TypeScript · Tailwind v4 · Vercel · Gemini (MVP) / AWS Bedrock
(enterprise) · **Aurora DSQL** (Phase 2 persistence).

> 📚 Full product docs, maturity model, architecture, backlog, and plan live in
> [`/docs`](./docs/README.md). Build journal in [`blog.md`](./blog.md).

## Quick start

```bash
npm install
cp .env.example .env.local   # optional — see below
npm run dev                  # http://localhost:3000
```

Then paste a public GitHub repo (e.g. `vercel/next.js`) and scan.

### Keys are optional

| Env | Effect |
|---|---|
| _(none)_ | **Mock mode** — deterministic rubric scoring from repo signals. Fully functional for demos/CI. |
| `GEMINI_API_KEY` | **Live mode** — Gemini adds qualitative nuance + roadmap on top of the signals. |
| `GITHUB_TOKEN` | Raises GitHub API rate limits (recommended for heavy use). |

`GEMINI_MODEL` overrides the model (default `gemini-3-flash-preview`).

## How it works

1. **Ingest** — read repo metadata, the git tree, a budgeted sample of file contents,
   and recent commits over the GitHub REST API (no clone; nothing stored).
2. **Detect** — deterministic analyzers (`src/lib/analyze`) extract evidence per
   dimension → reproducible signal scores.
3. **Score** — the engine (`src/lib/scoring`) sends signals + sampled content to an
   `LLMProvider`; the LLM's per-dimension score is **guardbanded** to the signal score,
   then blended and rolled up to an overall score + maturity level.
4. **Report** — overall gauge, dimension radar, evidence, and a prioritized roadmap;
   plus a shareable SVG badge.

```
src/
  app/
    page.tsx                          landing + scan entry
    report/page.tsx                   report view
    api/scan/route.ts                 POST: run a scan
    api/badge/[owner]/[repo]/route.ts GET: SVG maturity badge
  components/                         UI (Brand, ScanForm, report/*)
  lib/
    maturity/model.ts                 the rubric: levels, dimensions, weights
    github/source.ts                  repo ingestion
    analyze/index.ts                  deterministic detectors D1–D7
    llm/                              provider abstraction (gemini · mock · bedrock-ready)
    scoring/                          prompt · engine · recommendations
    scan.ts                           top-level orchestrator
```

## API

```bash
# POST
curl -s localhost:3000/api/scan -H 'content-type: application/json' \
  -d '{"url":"vercel/next.js"}' | jq .level

# GET (handy for links)
curl -s 'localhost:3000/api/scan?url=facebook/react&mock=1' | jq .overallScore
```

## Phase 2 — persistence (optional)

The MVP runs with no database. Turn on persistence (scan history, trends, audit,
multi-tenant) by pointing `DATABASE_URL` at Postgres locally or **Aurora DSQL** in prod.

```bash
docker compose up -d                                   # local Postgres (DSQL-compatible)
export DATABASE_URL=postgres://ascent:ascent@localhost:5432/ascent
npm run db:push                                        # create tables
npm run dev
```

With `DATABASE_URL` set, every scan is persisted and the report unlocks two extra
features: a **maturity-over-time trend chart** (with overall + per-dimension deltas vs.
the previous scan) and a **trackable roadmap** (mark each recommendation
open → in&nbsp;progress → done, saved to the DB). Without a DB, scans still work and the
report falls back to the static roadmap. Endpoints:

```bash
curl -s 'localhost:3000/api/history?repo=facebook/react' | jq '.scans[] | {scannedAt,level,overallScore}'
curl -s 'localhost:3000/api/recommendations?repo=facebook/react' | jq '.items[] | {title,status}'
curl -s -X PATCH 'localhost:3000/api/recommendations/<id>' -H 'content-type: application/json' -d '{"status":"done"}'
```

DB scripts: `db:push` (sync schema), `db:migrate` (create a migration), `db:studio`
(browse data), `db:generate` (regenerate client). Schema: [`prisma/schema.prisma`](./prisma/schema.prisma)
— DSQL-safe (`relationMode = "prisma"`, UUID PKs, no FK constraints). Reference DDL:
[`prisma/init.sql`](./prisma/init.sql). See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
§"Local development & Aurora DSQL".

## Private repositories (GitHub App)

Install the Ascent GitHub App to scan **private** repos via short-lived installation
tokens (Ascent stores only derived scores, never source). Visit **`/connect`** →
**Install on GitHub**. Setup + env in [`docs/GITHUB_APP.md`](./docs/GITHUB_APP.md).
Private scans are attributed to the installing org and counted as billable in
[`/usage`](./src/app/usage/page.tsx).

## Roadmap

Phase 2 in progress: ✅ DSQL-safe schema + persistence · history + **dimension trends**
(`/trends`) · **usage metering** (`/usage`) · **GitHub App** for private repos
(`/connect`) · **Bedrock** enterprise inference (set `LLM_PROVIDER=bedrock`).
Next: **Aurora DSQL** cluster (IAM-token auth; on Prisma 7+ via `@prisma/adapter-pg`),
**Auth.js + GitHub OAuth** to gate `/connect` `/usage` `/trends` per user/org, and
**push-triggered re-scans**. See [`docs/PLAN.md`](./docs/PLAN.md).

---
Scored by Ascent · #H0Hackathon
