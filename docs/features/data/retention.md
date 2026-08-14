# Data retention & purge

A daily Vercel Cron job enforces each org's data-retention policy: keep only the newest N
scans per repo (and their dimensions/recommendations), and drop audit entries older than X
days. `Scan`, `ScanDimension`, `Recommendation`, and `AuditLog` otherwise grow unbounded as
the corpus scales: a storage-cost and compliance liability for an audit product.

## Auth

`GET /api/cron/purge` (`src/app/api/cron/purge/route.ts`) verifies `CRON_SECRET` via the shared
`requireCronAuth` gate (`src/lib/cron-auth.ts`), which accepts
`Authorization: Bearer <secret>` **only**: no cron route accepts a `?key=` query param any
more (G8-48; `CRON_ALLOW_QUERY_KEY=1` is a temporary hatch), since query strings are routinely captured by
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
deletes nothing; existing deployments keep all history until they ask for retention.

**Safety floor:** a configured-but-nonzero policy below `RETENTION_MIN_SCANS_PER_REPO` (5) or
`RETENTION_MIN_AUDIT_DAYS` (7) is **refused** rather than applied: the org is skipped and an
error is pushed (tripping the route's degraded-run status) unless the operator opts in with
`RETENTION_FORCE=1`. This guards against a fat-fingered override irreversibly wiping an org's
compliance evidence. `0` ("keep everything") is never floored.

## `purgeExpiredData()` mechanics

Per org enforcing a policy:

1. **Prune scans** beyond the newest *N* per repo (ordered `createdAt desc, id desc`),
   deleting grandchild `RecommendationEvent`, then child `ScanDimension` +
   `Recommendation`, then the parent `Scan` (no FK cascades under `relationMode = "prisma"`).
   Both the repo enumeration and the stale-scan selection are paged, not read unbounded, so a
   huge fleet org doesn't blow a single read past a statement timeout.
2. **Prune audit** entries older than the cutoff (per-org scoped), oldest first.
3. Record a `retention.purged` audit entry (the job audits itself), only when something was
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
calendar day** (`rotateForTick`, a deterministic round-robin, not a random shuffle) so a fleet
too large to drain in one tick still reaches every org within a bounded number of ticks instead
of the same prefix winning every run.

**Dry run:** `?dryRun=1` (or `true`) on the route counts what every effective policy *would*
delete (per-repo stale-scan totals, in-window audit rows) without deleting anything or writing
an audit entry; the summary carries `dryRun: true`. The safety floor above is not enforced in
a dry run.

## On-demand erasure (DSR / right-to-erasure)

Retention above is **schedule-only**: data leaves on the cron's timetable. `POST /api/org/erase`
is the owner-triggered counterpart an enterprise/regulated buyer's vendor review expects (GDPR
Art. 17, SOC 2): erase this tenant's data *now*.

```jsonc
// org-wide
POST /api/org/erase  { "org": "acme", "confirm": "acme", "includeAudit": false }
// one repo
POST /api/org/erase  { "org": "acme", "repo": "acme/api", "confirm": "acme/api" }
```

The route follows the org-API convention (tenant in the body, no `[slug]` path segment) like every
sibling under `src/app/api/org`. Three guards, in order:

1. **Same-origin** (`requireSameOrigin`): guards against CSRF. The session cookie is only `SameSite=Lax`, which
   does not stop a cross-site form POST, and a bare cross-site POST must never be able to erase a
   tenant. Same helper the other destructive/money-adjacent routes use.
2. **Typed confirmation**: `confirm` must echo the *target's own name*, the org slug (matched
   case-insensitively, as slugs are everywhere) or, for the repo variant, the repo's exact full name.
   A `{ org }`-only payload is a `400` before any authz work, so an accidental or replayed POST
   deletes nothing. Confirming an org-wide erase can never be satisfied by a repo-scoped payload.
3. **Owner role** (`requireOrgRole(org, "owner")`): irreversible, so not a member action.

`eraseOrgData()` (`src/lib/db/retention.ts`) then reuses the cron's own primitives, `pruneRepoScans`
with a keep-window of **0** (keep nothing) and `pruneAudit` with **no date cutoff**, so the erasure
path can never drift from the delete graph the purge maintains, and inherits its DSQL batching and
conflict retries.

- **Scope.** Scans + dimensions + recommendations + recommendation events for the org's repos, plus
  the *scan-derived caches* denormalized onto `Repository` (`techStackJson`, `passportJson`,
  `headSha`/`headEtag`, `lastScan*`); otherwise an "erased" repo would still render its cached
  passport. Owner-authored configuration (watch flag, schedule, segment tags, passport overrides) and
  the `Organization` / `Repository` / `Membership` rows themselves are **kept**: erasure removes the
  data, it does not unconfigure or delete the tenant.
- **Audit trail.** Erased only with `includeAudit: true`, and org scope only (audit rows are not
  repo-scoped). Destroying compliance evidence is a separate, explicit ask from erasing scan data.
- **Bounded + resumable.** Never one mega-transaction: every delete is a small batched transaction,
  the repo enumeration is cursor-paged, and a wall-clock budget (`ERASE_MAX_DURATION_S` − headroom,
  mirroring the cron's derivation and pinned to the route's `maxDuration` by a test) is polled
  between repos and between batches. A tenant too large for one request stops at a batch boundary and
  returns `complete: false`; every committed batch is durable, so **repeating the identical request
  resumes** it (the endpoint is idempotent).
- **Audit ordering.** The `data.erased` entry is written **after** the deletes, never before. An
  org-scoped audit sweep here has no cutoff, so an entry written first would be deleted by the very
  operation it documents; written last, it is the *only* audit row that survives an audit-including
  erasure: the trail is emptied and the record of why remains. The trade-off: a crash between the
  deletes and the audit write loses the trace, which surfaces as `audited: false`.
- **Status mapping.** `200` on a complete, audited erasure; **`207`** when it stopped early
  (`resumable: true`) or the `data.erased` write failed: "mostly erased" and "erased with no record"
  are degraded outcomes a caller must act on, not green results; `404` unknown org/repo, `503` no DB.

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
**`207`** (Multi-Status) when `errors.length > 0` or `stoppedEarly` is true (a degraded run
must never report a green `200`, since cron/uptime monitors only watch HTTP status), and
`500` on a total failure.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/cron/purge/route.ts` | Route handler: auth, DB-configured gate, dry-run flag, degraded-status (207) mapping. |
| `src/app/api/org/erase/route.ts` | On-demand DSR erasure: CSRF + typed-confirmation + owner gates, 207 degraded mapping. |
| `src/lib/db/retention.ts` | `resolveRetention`, `purgeExpiredData` (batched, OCC-retrying, budgeted, rotated), `eraseOrgData`. |
| `src/lib/db/retention.test.ts` | Policy + purge + erasure tests. |

## Known gaps

- **With no retention env set, nothing is deleted**: existing deployments keep all
  history by default (opt-in). On-demand erasure (above) does not depend on a policy.
- **Erasure keeps the tenant's shell**: `Organization`, `Repository`, `Membership` and
  owner-authored config rows survive an erase; there is no "close the account" endpoint yet.
- **Cron schedules live in deploy config** (`vercel.json` / dashboard), not in code; this
  doc covers the handler and purge mechanics, not the cadence.
- The round-robin rotation's "every org reached within N ticks" guarantee assumes exactly one
  tick per calendar day and a stable org population; more-than-daily scheduling or heavy org
  churn degrade it back to best-effort.
