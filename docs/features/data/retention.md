# Data retention & purge

A daily Vercel Cron job enforces each org's data-retention policy: keep only the newest N
scans per repo (and their dimensions/recommendations), and drop audit entries older than X
days. `Scan`, `ScanDimension`, `Recommendation`, and `AuditLog` otherwise grow unbounded as
the corpus scales — a storage-cost and compliance liability for an audit product.

## Auth

`GET /api/cron/purge` (`src/app/api/cron/purge/route.ts`) verifies `CRON_SECRET` via
`Authorization: Bearer <secret>` **only** — unlike the rescan/digest cron routes, it does
**not** accept a `?key=` query param, since query strings are routinely captured by
access/CDN/proxy logs and Referer headers, and this endpoint can delete data. A missing/empty
`CRON_SECRET` fails closed (503). Requires `DATABASE_URL`; a DB-unconfigured deploy also fails
closed (503) unless `RETENTION_ALLOW_NO_DB=1` opts into a deliberate no-op skip (e.g. the
keyless MVP).

## Retention policy (`src/lib/db/retention.ts`)

Policy is global env defaults, overridable per org:

| Setting | Env default | Per-org override (`Organization`) |
| --- | --- | --- |
| Max scans kept per repo | `RETENTION_MAX_SCANS_PER_REPO` (0 = unlimited) | `retentionMaxScans` (null = inherit) |
| Audit-log age | `RETENTION_AUDIT_DAYS` (0 = unlimited) | `retentionAuditDays` (null = inherit) |
| Delete batch size | `RETENTION_BATCH_SIZE` (clamped 500–5000) | — |

`resolveRetention(defaults, org)` merges them (a per-org override wins when set, including an
explicit `0` for unlimited; `null` inherits the default).

**Retention is opt-in:** with nothing configured, every window is 0 and `purgeExpiredData()`
deletes nothing — existing deployments keep all history until they ask for retention.

**Safety floor:** a configured-but-nonzero policy below `RETENTION_MIN_SCANS_PER_REPO` (5) or
`RETENTION_MIN_AUDIT_DAYS` (7) is **refused** rather than applied — the org is skipped and an
error is pushed (tripping the route's degraded-run status) unless the operator opts in with
`RETENTION_FORCE=1`. This guards against a fat-fingered override irreversibly wiping an org's
compliance evidence. `0` ("keep everything") is never floored.

## `purgeExpiredData()` mechanics

Per org enforcing a policy:

1. **Prune scans** beyond the newest *N* per repo (ordered `createdAt desc, id desc`),
   deleting grandchild `RecommendationEvent`, then child `ScanDimension` +
   `Recommendation`, then the parent `Scan` — no FK cascades under `relationMode = "prisma"`.
   Both the repo enumeration and the stale-scan selection are paged, not read unbounded, so a
   huge fleet org doesn't blow a single read past a statement timeout.
2. **Prune audit** entries older than the cutoff (per-org scoped), oldest first.
3. Record a `retention.purged` audit entry (the job audits itself) — only when something was
   actually deleted, so a configured-but-currently-idle policy doesn't write an all-zero row
   every tick.

It also sweeps org-less audit entries (anonymous public scans) under the global default, and
sweeps expired `PublicScanQuota` rows on every pass.

**DSQL-safe:** deletes run in small batches; serialization conflicts (Aurora DSQL's OC###
codes, 40P01 deadlock, Prisma P2034) are retried with jittered backoff via the shared
`withRetry` (`src/lib/db/client.ts`).

**Wall-clock budget:** each run stops cleanly (partial, resumable summary) a bit before the
route's `maxDuration` (`RETENTION_TIME_BUDGET_MS`, derived from `PURGE_MAX_DURATION_S`, default
budget = 300s − 50s headroom; `0` = unlimited). The budget is polled between orgs, between
repos within an org, and between delete batches, so a single mega-org can't consume the whole
budget without yielding. Orgs are visited in a stable oldest-first order, **rotated once per
calendar day** (`rotateForTick`, a deterministic round-robin — not a random shuffle) so a fleet
too large to drain in one tick still reaches every org within a bounded number of ticks instead
of the same prefix winning every run.

**Dry run:** `?dryRun=1` (or `true`) on the route counts what every effective policy *would*
delete (per-repo stale-scan totals, in-window audit rows) without deleting anything or writing
an audit entry; the summary carries `dryRun: true`. The safety floor above is not enforced in
a dry run.

## Return shape (`PurgeSummary`)

```ts
{
  orgsProcessed: number,
  scansDeleted: number,
  dimensionsDeleted: number,
  recommendationsDeleted: number,
  recommendationEventsDeleted: number,
  auditDeleted: number,
  results: OrgPurgeResult[],   // per-org (or "(orphan)") breakdown, each with its resolved policy
  errors: string[],
  stoppedEarly: boolean,       // the wall-clock budget stopped the run before every org/sweep was reached
  orgsRemaining: number,       // orgs with a policy still left unprocessed (0 on a complete run)
  dryRun: boolean,
}
```

The route (`src/app/api/cron/purge/route.ts`) returns this summary as `200` on a clean run,
**`207`** (Multi-Status) when `errors.length > 0` or `stoppedEarly` is true — a degraded run
must never report a green `200`, since cron/uptime monitors only watch HTTP status — and
`500` on a total failure.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/cron/purge/route.ts` | Route handler: auth, DB-configured gate, dry-run flag, degraded-status (207) mapping. |
| `src/lib/db/retention.ts` | `resolveRetention`, `purgeExpiredData` (batched, OCC-retrying, budgeted, rotated). |
| `src/lib/db/retention.test.ts` | Policy + purge tests. |

## Known gaps

- **With no retention env set, nothing is deleted** — existing deployments keep all
  history by default (opt-in).
- **Cron schedules live in deploy config** (`vercel.json` / dashboard), not in code; this
  doc covers the handler and purge mechanics, not the cadence.
- The round-robin rotation's "every org reached within N ticks" guarantee assumes exactly one
  tick per calendar day and a stable org population; more-than-daily scheduling or heavy org
  churn degrade it back to best-effort.
