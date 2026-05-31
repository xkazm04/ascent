# Cron jobs & data retention

Two scheduled jobs keep persisted data fresh and bounded: a **rescan** job re-scores
watched repos on their schedule (and alerts on regressions), and a **purge** job enforces
each org's retention policy. Both are Vercel Cron endpoints guarded by a shared secret and
both require `DATABASE_URL`.

## Auth

Each endpoint verifies `CRON_SECRET` via `Authorization: Bearer <secret>` or `?key=<secret>`.

## Rescan (`src/app/api/cron/rescan/route.ts`)

`GET /api/cron/rescan` scans every repo whose `nextScanAt <= now` (`listDueRescans()`).
Per repo:

1. Resolve an installation token (`getInstallationIdForOwner` → `getInstallationToken`).
2. Capture the prior persisted report (`getScanReportByCommit`) **before** the new scan.
3. Run `scanRepository()` with the installation token (private-repo capable).
4. `persistScanReport()` — returns dedup + failure flags.
5. If not deduped, `checkAndAlertRegression(prev, fresh)` (see [alerts.md](alerts.md)).
6. `advanceSchedule(repoId, scanSchedule)` to set the next window.

Returns `{ due, scanned, errors }`. `maxDuration = 300` (Vercel's 5-min cron limit).

## Purge (`src/app/api/cron/purge/route.ts`)

`GET /api/cron/purge` calls `purgeExpiredData()` and returns a `PurgeSummary` (orgs
processed, rows deleted per type, per-org results/errors).

## Retention policy (`src/lib/db/retention.ts`)

Policy is global env defaults overridable per org:

| Setting | Env default | Per-org override (`Organization`) |
| --- | --- | --- |
| Max scans kept per repo | `RETENTION_MAX_SCANS_PER_REPO` (0 = unlimited) | `retentionMaxScans` (null = inherit) |
| Audit-log age | `RETENTION_AUDIT_DAYS` (0 = unlimited) | `retentionAuditDays` (null = inherit) |
| Delete batch size | `RETENTION_BATCH_SIZE` (clamped 500–5000) | — |

`resolveRetention(defaults, org)` merges them. `purgeExpiredData()` then, per org enforcing
a policy:

1. **Prune scans** beyond the newest *N* per repo (ordered `scannedAt desc, id desc`),
   deleting child `ScanDimension` + `Recommendation` rows first (no FK cascades under
   `relationMode = "prisma"`).
2. **Prune audit** entries older than the cutoff (per-org scoped).
3. Record a `retention.purged` audit entry (the job audits itself).

It also sweeps org-less audit entries (anonymous public scans) under the global default.

**DSQL-safe:** deletes run in small batches; serialization conflicts (OCC, Prisma P2034 /
SQLSTATE 40001) are retried with linear backoff.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/cron/rescan/route.ts` | Re-scan due watched repos + regression alerting. |
| `src/app/api/cron/purge/route.ts` | Enforce retention. |
| `src/lib/db/retention.ts` | `resolveRetention`, `purgeExpiredData` (batched, OCC-retrying). |
| `src/lib/db/retention.test.ts` | Policy + purge tests. |

## Known gaps

- **With no retention env set, nothing is deleted** — existing deployments keep all
  history by default (opt-in).
- **Cron schedules live in deploy config** (`vercel.json` / dashboard), not in code; this
  doc covers the handlers, not the cadence.
