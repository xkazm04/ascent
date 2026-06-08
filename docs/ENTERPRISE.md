# Ascent — Enterprise: org-wide AI-native maturity management

> **Status: built (E1–E5) and verified.** This documents the system as shipped.

The product's selling point is **not** "scan one private repo" — it's **managing the
AI-native maturity of an entire organization's repository fleet over time**: mass-scan,
roll up, compare contributors, watch a subset, and auto-track on a schedule.

---

## 1. The end-to-end flow

```
                         ┌──────────────────────────────────────────────┐
                         │  GitHub App install (private)  OR             │
                         │  public-org import by name (token, no App)    │
                         └───────────────────┬──────────────────────────┘
                                             │ repo list
                  ┌──────────────────────────▼───────────────────────────┐
   watch toggle → │  Repository rows  (watched · scanSchedule · nextScanAt)│
   /connect       └──────────────────────────┬───────────────────────────┘
                                             │ watched set
        manual  ─────────────────────────────┤
        "Scan all"   POST /api/org/scan (SSE) │  cron  GET /api/cron/rescan
        from the     scans each watched repo  │  (Vercel Cron, daily)
        dashboard    with the install token   │  scans repos whose nextScanAt is due
                                             ▼
                  ┌──────────────────────────────────────────────────────┐
                  │  scanRepository()  →  ScanReport (8 dims, axes,        │
                  │  posture, archetype, contributors, discrepancies)      │
                  └──────────────────────────┬───────────────────────────┘
                                             │ persistScanReport(report, {orgSlug})
                  ┌──────────────────────────▼───────────────────────────┐
                  │  Scan · ScanDimension · Recommendation · RepoContributor│
                  │  (+ Repository.lastScanAt, advanceSchedule → nextScanAt)│
                  └──────────────────────────┬───────────────────────────┘
                                             │ getOrgRollup / getOrgContributors
                  ┌──────────────────────────▼───────────────────────────┐
                  │  /org/[slug] dashboard                                 │
                  │  tiles · posture mix · dim averages · trend ·          │
                  │  leaderboard · repo×dimension heatmap · contributors   │
                  └────────────────────────────────────────────────────────┘
```

Two ways repos enter the fleet:

- **Private (GitHub App):** install Ascent on the org. `/connect` lists the installation's
  repos with a **watch toggle** and **schedule** selector. Bulk scan and cron use the
  short-lived installation token. Requires `GITHUB_APP_*` + `DATABASE_URL`.
- **Public org (token, no App):** `POST /api/org/import` lists an org's most-recently-pushed
  **public** repos and scans them under the org slug. Needs only `GITHUB_TOKEN` + `DATABASE_URL`.
  This is the free-tier funnel — *and* the local demo/seed path (see §5).

---

## 2. Data model (Prisma → Aurora DSQL / local Postgres)

`relationMode = "prisma"` (DSQL-safe: no FK constraints, UUID PKs, JSON-in-TEXT).

| Model | Enterprise fields |
|---|---|
| **Organization** | `slug` (unique), `name`, `plan` |
| **Repository** | `watched: Bool`, `scanSchedule: String` (`off`/`daily`/`weekly`/`monthly`), `lastScanAt`, `nextScanAt`, `@@unique([orgId, fullName])` |
| **Scan** | `level`, `overallScore`, **`adoptionScore`**, **`rigorScore`**, **`posture`**, **`archetype`**, `scannedAt` |
| **ScanDimension** | `dimId` (D1–D9), `score`, `level`, `rationale` |
| **RepoContributor** | `repoId`, `login`, `name`, `commits`, `aiCommits`, `lastActiveAt`, `@@unique([repoId, login])` |
| **Recommendation** | `dimId`, `title`, `status` (carry-forward across scans) |

`level`/`posture` persist as their **string ids** (`L2`, `manual`), not the display objects.

---

## 3. Routes & responsibilities

| Route | Method | Auth gate | What it does |
|---|---|---|---|
| `/api/org/watch` | POST | App + DB | Upsert a repo + set its `watched` flag |
| `/api/org/schedule` | POST | App + DB | Set `scanSchedule` + compute `nextScanAt` |
| `/api/org/scan` | POST (SSE) | App + DB | Bulk-scan every **watched** repo via the install token; persist each; per-repo progress |
| `/api/org/import` | POST (SSE) | DB (+ token) | **Token-based** bulk scan of a **public** org's repos by name — no App. Lists + scans + persists + optionally watches/schedules |
| `/api/cron/rescan` | GET | `CRON_SECRET` | Scan repos whose `nextScanAt` is due; `advanceSchedule` after each |
| `/api/cron/purge` | GET | `CRON_SECRET` | Enforce data retention: prune old scans/dimensions/recs + stale audit entries; record an audit entry |

DB query layer (`src/lib/db/org.ts`): `setRepoWatch`, `setRepoSchedule`, `listWatchedRepos`,
`listDueRescans`, `advanceSchedule`, `getRepoStates`, `getOrgContributors`, `getOrgRollup`.

`getOrgRollup` returns repos that are **watched OR have at least one scan**, so a token-imported
org with no App still appears on the dashboard. It also carries a `forecast` field — a linear
trajectory fit over the per-day `trend` series (`src/lib/maturity/forecast.ts`) that projects the
maturity score forward and estimates an ETA to the next level promotion/demotion. It is `null`
until at least two distinct scan days exist; the org overview renders it as the **Trajectory** card.

---

## 4. Autoscans

`vercel.json` registers a daily cron:

```json
{ "crons": [{ "path": "/api/cron/rescan", "schedule": "0 6 * * *" }] }
```

Vercel calls `GET /api/cron/rescan` with `Authorization: Bearer $CRON_SECRET`. The handler:

1. `listDueRescans()` → repos where `watched=true AND scanSchedule != "off" AND nextScanAt <= now()`.
2. For each: scan with the owner's installation token, `persistScanReport`, then
   `advanceSchedule(repoId, schedule)` → pushes `nextScanAt` forward (daily +1d / weekly +7d / monthly +30d).

Setting a schedule on `/connect` seeds the first `nextScanAt`; the cron keeps it rolling.

---

## 5. Data retention & automated purge

`Scan`, `ScanDimension`, `Recommendation`, and `AuditLog` otherwise grow unbounded — a DSQL
storage-cost and compliance liability for an audit product. A second daily cron enforces a
configurable retention policy, mirroring the windows Datadog / Splunk / Stripe expose.

```json
{ "crons": [{ "path": "/api/cron/purge", "schedule": "0 4 * * *" }] }
```

**Policy (per org, with global env defaults).** Two windows; `0`/unset = keep everything, so
retention is opt-in and existing deployments are unaffected until configured:

| Window | Global default (env) | Per-org override (`Organization`) |
|---|---|---|
| Keep newest **N scans / repo** (+ their dimensions & recommendations) | `RETENTION_MAX_SCANS_PER_REPO` | `retentionMaxScans` |
| Drop **audit entries older than X days** | `RETENTION_AUDIT_DAYS` | `retentionAuditDays` |

A per-org column wins when set (`null` = inherit the env default; an explicit `0` = unlimited).
`RETENTION_BATCH_SIZE` (default 500) bounds each delete batch.

**The handler (`purgeExpiredData`, `src/lib/db/retention.ts`):**

1. For each org, resolve its effective policy (override ?? env default); skip orgs with no active window.
2. Per repo: delete every `Scan` beyond the newest N (newest by `scannedAt`), removing its
   `ScanDimension` + `Recommendation` rows first (`relationMode = "prisma"` emits no FK cascade).
3. Delete `AuditLog` rows older than the cutoff (org-less entries from anonymous scans are swept
   under the global default).
4. Record a `retention.purged` audit entry with the deleted counts — **the job audits itself**.

**DSQL-safe:** deletes run in small batches and each batch retries on a serialization conflict
(`P2034` / SQLSTATE `40001`), matching DSQL's optimistic concurrency model.

---

## 6. Local demo / seeding (no GitHub App needed)

Because `/api/org/import` is token-only and public-repo-only, you can populate a real org's
dashboard locally with one command. Requires `DATABASE_URL` (docker Postgres) + `GITHUB_TOKEN`
(in `.env` or `gh auth token`).

```bash
# docker compose up -d && npm run db:push   (once)
# dev server running with DATABASE_URL + GITHUB_TOKEN

node scripts/seed-org.mjs vercel 20          # 20 most-recently-pushed public vercel repos
node scripts/seed-org.mjs vercel 20 --live   # use the real LLM provider instead of mock
```

Then open **/org/vercel**. The script streams per-repo progress and a final summary; it
calls `/api/org/import` under the hood (default `mock=true`, `watch=true`, `schedule=weekly`).

Mock mode still fetches **real** repo structure — only the LLM-written nuance is stubbed — so
dimension scores, axes, posture, and contributors are all real, signal-driven, and fast.

---

## 7. Build sequence (as delivered)

| Phase | Slice | Status |
|---|---|---|
| **E1** | Schema (watched/schedule/contributors) + watch toggle + watch/schedule APIs | ✅ |
| **E2** | Bulk "scan all watched" (SSE) + dashboard trigger | ✅ |
| **E3** | Org rollup dashboard (`/org/[slug]`) — tiles, posture mix, leaderboard, heatmap, trend | ✅ |
| **E4** | Contributor ingestion + per-repo & org "who's AI-native" comparison | ✅ |
| **E5** | Autoscans — Vercel Cron + per-repo schedule management | ✅ |
| **+** | `/api/org/import` — token-based public-org onboarding & seeder | ✅ |

**Verified:** lint + build green; DB integration (schema push, scans persisted with axes/
posture/contributors, dashboard renders); App-gated routes return clean `503`; cron due-logic
(`listDueRescans` + `advanceSchedule`) correct; e2e 3/3.

**Production preconditions:** `DATABASE_URL` (Aurora DSQL) for everything; `GITHUB_APP_*` for
the private-repo watch/bulk/cron path; `CRON_SECRET` to protect the cron endpoint. See
`SETUP.md` / `GITHUB_APP.md`.
