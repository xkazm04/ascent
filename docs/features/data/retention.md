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
| Compact pruned scans into digests | `RETENTION_COMPACT` (**default off**) | `retentionCompact` (null = inherit) |
| Digest age | `RETENTION_DIGEST_MONTHS` (0 = keep digests forever) | `retentionDigestMonths` (null = inherit) |

`resolveRetention(defaults, org)` merges them (a per-org override wins when set, including an
explicit `0` for unlimited; `null` inherits the default).

**Retention is opt-in:** with nothing configured, every window is 0 and `purgeExpiredData()`
deletes nothing; existing deployments keep all history until they ask for retention.

**Safety floor:** a configured-but-nonzero policy below `RETENTION_MIN_SCANS_PER_REPO` (5) or
`RETENTION_MIN_AUDIT_DAYS` (7) is **refused** rather than applied: the org is skipped and an
error is pushed (tripping the route's degraded-run status) unless the operator opts in with
`RETENTION_FORCE=1`. This guards against a fat-fingered override irreversibly wiping an org's
compliance evidence. `0` ("keep everything") is never floored.

The on-demand erase path carries the same shape of floor over its own destructive reach — see
[the audit-disposition table](#on-demand-erasure-dsr--right-to-erasure) and `ERASE_AUDIT_FORCE=1`.

## `purgeExpiredData()` mechanics

Per org enforcing a policy:

1. **Prune scans** beyond the newest *N* per repo (ordered `createdAt desc, id desc`), **folding each
   page into a `ScanDigest` first when compaction is on** (see below), then deleting grandchild
   `RecommendationEvent`, then child `ScanDimension` + `Recommendation`, then the parent `Scan` (no
   FK cascades under `relationMode = "prisma"`). Fold and deletes share **one transaction**. Both the
   repo enumeration and the stale-scan selection are paged, not read unbounded, so a huge fleet org
   doesn't blow a single read past a statement timeout.
2. **Prune digests** older than `retentionDigestMonths` (skipped entirely at the `0` sentinel).
3. **Prune audit** entries older than the cutoff (per-org scoped), oldest first.
4. Record a `retention.purged` audit entry (the job audits itself), only when something was
   actually deleted, so a configured-but-currently-idle policy doesn't write an all-zero row
   every tick. Its `meta` carries `digestsWritten` / `scansCompacted` / `digestsDeleted` beside the
   delete counts — the compliance trace has to say what **survived**, not only what died.

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
a dry run. With compaction on it also reports `digestsWouldWrite` — or **`null`** once the stale
window passes `DIGEST_PREVIEW_MAX_SCANS` (5000), because past that an estimate would be a guess
wearing a number's clothes. The **scan** count is unaffected: it still comes from the one shared
`where`, so "the number you were shown is the number that dies" still holds.

## Compaction: a pruned scan ages into a digest

Retention used to be a choice between keeping every `Scan` row forever and deleting the timeline that
trends, forecasts and outcome deltas stand on. With `RETENTION_COMPACT` on, a purged page of scans is
**folded into a `ScanDigest`** — one row per repo × month × rubric version × engine provider — inside
the same transaction that deletes it, and readers can serve that tail explicitly labelled
`compacted`. Implementation: `src/lib/db/scan-digest.ts`.

**Off by default.** With nothing configured a deployment's purge is byte-for-byte what it always was —
the page `SELECT` is still `{ id: true }` and no digest table is touched.

**The keys.** `(repoId, period, rubricVersion, engineProvider)` is unique. `period` is a UTC month
bucket (`YYYY-MM`) so a boundary never moves with a viewer's timezone. `rubricVersion` is **non-null
by construction**: a legacy scan with no rubric stamp folds into the literal `"unknown"`, because
Postgres treats NULLs as distinct and a nullable key column would make the upsert insert a fresh row
on every tick. The sentinel exists for the constraint, not to claim knowledge — the reader maps
`"unknown"` straight back to `rubricVersion: null` on the wire, so anything that refuses to compare
across instruments keeps refusing.

**Sums, not means.** A later tick folds more scans of the same period into the row an earlier tick
wrote, so the row stores `*Sum` + `scanCount` (plus min/max and timestamp-governed first/last). That
makes the merge exact and order-independent; a stored mean would drift the moment two pages had
unequal sizes. Means are derived on read.

**Idempotency is atomicity.** The fold is committed by the same `$transaction` as the `deleteMany`
that removes its inputs, so a retried batch (a DSQL OC###/40P01 conflict through `withRetry`) rolls
back both halves and re-selects only surviving rows. No scan can be folded twice, and none can die
without its summary.

**Unknown ≠ 0.** A dimension no scan in the period carried is absent from `dimensionsJson`, and the
reader emits no entry for it — so a dimension line renders a gap, never a fabricated floor.

**A compacted point has no permalink.** `getRepositoryHistory(owner, name, { includeCompacted: true })`
appends the tail after the retained scans, bounded by the oldest retained scan so a straddling period
is never counted twice. Each point carries `compacted: true`, a `scanCount`, an `id` of
`digest:<row.id>`, and **`headSha: null`** — the `Scan` row is gone, so a report permalink built from
the stored sha would 404. Withholding the handle is what makes the point non-navigable in the chart
and the CSV with no change to their link logic. `engineModel` reads `"mixed"` when more than one
model scored the period. Default is **off**: the compare picker, the skill-outcome loader and
`/api/history` without the param are unchanged.

**Where it surfaces.** `/trends` requests the tail; `TrendChart` draws the compacted run as a single
dashed segment with hollow points and one legend line, and names it in the screen-reader table (the
encoding is visual only). `/api/history?compacted=1` opts in over the API, and the CSV export gains
`compacted` + `scans` columns so a spreadsheet is honest about which row is a summary.
`forecastBasis(forecast)` states how many of a fit's days were compacted; `getCompactionCoverage(org)`
reports how far the tail reaches beyond the retained scans (both degrade to `null`, never zeros).
`MIN_FORECAST_POINTS` and the `lowData` rule are untouched — a compacted day counts as one day.

**Erasure refuses to compact.** See below.

## On-demand erasure (DSR / right-to-erasure)

Retention above is **schedule-only**: data leaves on the cron's timetable. `POST /api/org/erase`
is the owner-triggered counterpart an enterprise/regulated buyer's vendor review expects (GDPR
Art. 17, SOC 2): erase this tenant's data *now*.

```jsonc
// org-wide
POST /api/org/erase  { "org": "acme", "confirm": "acme", "includeAudit": false }
// one repo
POST /api/org/erase  { "org": "acme", "repo": "acme/api", "confirm": "acme/api" }
// preview first: same request, no `confirm` needed, nothing is touched
POST /api/org/erase  { "org": "acme", "preview": true, "includeAudit": true }
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
   A **preview** (`preview: true`) skips this gate deliberately — being told the blast radius is what
   makes typing the name an informed act — but keeps guards 1 and 3.
3. **Owner role** (`requireOrgRole(org, "owner")`): irreversible, so not a member action. Previews are
   owner-gated too: the counts ("412 scans across 37 repositories") describe the tenant.

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
- **Improvement-loop history (org scope only).** `LoopRunLane` then `LoopRun`
  ([org-planning/live.md](../org-planning/live.md)) — the runs name the repos that were worked, the
  branch each lane produced, the follow-up ids it dispatched and closed, and the agent's log, so they
  are tenant data like the scans. Lanes are deleted **before** their runs (`relationMode = "prisma"`
  emits no cascade, exactly as for the scan graph). Batched and budget-polled like every other loop,
  so a large history stops at a batch boundary and resumes on the next call. The repo-scoped variant
  never touches them: a run belongs to the org, not to a repo. Counted as `loopRunsDeleted` /
  `loopLanesDeleted` on the result (and in the `data.erased` audit entry); a **preview** counts them
  without deleting.
- **Compacted tail (moonshot #32).** An erase passes `compact: false` **always**, whatever the org's
  policy says — a right-to-erasure request must not mint a durable summary of the very data it is
  erasing — and deletes the repo's existing `ScanDigest` rows beside the scan graph, batched and
  budget-polled like every other loop. Counted as `digestsDeleted` on the result and in the
  `data.erased` audit entry; a preview counts them over the same `{ repoId }` predicate.
- **Audit trail — three dispositions, org scope only** (audit rows are not repo-scoped). The
  interactive path reaches the same HMAC-signed compliance evidence the cron does, so it now carries
  the same kind of destructive-override floor the cron has had (`RETENTION_FORCE`):

  | `auditDisposition` | Effect |
  | --- | --- |
  | `"keep"` (default) | The trail is untouched; only scan data is erased. |
  | `"redact"` | **Identifier-only erasure.** Every row survives as *action + timestamp + tenant*; `actorId` is nulled, the whole `meta` payload is replaced by a `_redacted` marker, and the row is **re-signed** so it still verifies. The subject reference stops resolving to a person; the historical account of what happened and when stays exportable. |
  | `"delete"` | Wholesale destruction of the trail. **Refused with `409`** unless the deployment sets `ERASE_AUDIT_FORCE=1` — the destructive act has to be an act of intent, and the request that asks for it must not also be able to authorise it. |

  `includeAudit: true` is the legacy alias and now resolves to **`"redact"`**, not `"delete"`: same
  user-visible promise (this org's trail no longer identifies anyone), without the irreversible loss.
  Refusal is not prohibition — a genuinely compelled erasure is exactly what the flag exists for, so
  the `409` body names both ways forward (redact, or the operator override).
  Counts are reported separately as `auditRedacted` and `auditDeleted`.
- **Preview (`preview: true`).** Runs the whole request as a count — nothing deleted, redacted, or
  audited — and returns the same result shape with `dryRun: true`. The scan count comes from the
  *same* `where` predicate inside `pruneRepoScans` that the delete selection pages over, and the audit
  count from the same `{ orgId }` sweep predicate: a preview built from a second, separately written
  query is worse than none, because it licenses an irreversible act with a number that can drift.
  Like the cron dry run, the disposition floor is **not** enforced in a preview — seeing what a
  `delete` would cost is the input to that decision, not the decision.
- **The confirmation shows the count before it asks for the name.** The org-settings dialog fetches
  the preview when it opens, and **again whenever the audit disposition changes** (the audit
  casualties differ between keeping the trail and redacting it), then renders scans, repositories and
  audit rows affected beside the confirm field. The destructive button stays **disabled until a count
  has actually rendered**: echo-to-confirm only means anything if the operator was told what they are
  confirming. A preview that FAILS renders **unknown** and leaves the button disabled — it never
  falls back to zeros, because a failed count displayed as "0 scans" is reassurance that was never
  received, and is precisely what would talk an owner into an erasure whose size nobody measured. A
  preview stopped by its own time budget (`complete: false`) is labelled "at least N" rather than
  presented as a total.
- **The dialog and the receipt describe the SAME disposition.** The manifest calls the audit opt-in
  what it is — redaction — and puts a row in *both* columns, because that is what redaction does:
  the actor and every `meta` payload move to "Erased, permanently", while *what happened and when*
  moves to "Kept, untouched". After the act, the receipt reads `auditDisposition` off the response
  and reports it in the same words the preview used ("redacted to identifier-only" / "destroyed" /
  "trail kept"), counting `auditDeleted + auditRedacted`. Until 2026-08-29 it read `auditDeleted`
  alone — which is 0 on every path the UI can reach, since `includeAudit: true` resolves to
  `"redact"` — so redacting an entire trail was reported as "Audit rows 0 · audit trail kept", and
  the arming manifest above it promised that only the `data.erased` entry would survive. Both are
  pinned by `DataErasureCard.outcomes.test.tsx`.
- **Bounded + resumable.** Never one mega-transaction: every delete is a small batched transaction,
  the repo enumeration is cursor-paged, and a wall-clock budget (`ERASE_MAX_DURATION_S` − headroom,
  mirroring the cron's derivation and pinned to the route's `maxDuration` by a test) is polled
  between repos and between batches. A tenant too large for one request stops at a batch boundary and
  returns `complete: false`; every committed batch is durable, so **repeating the identical request
  resumes** it (the endpoint is idempotent).
- **Audit ordering.** The `data.erased` entry is written **after** the deletes, never before. An
  org-scoped audit sweep here has no cutoff, so an entry written first would be deleted by the very
  operation it documents; written last, it is the *only* audit row that survives an audit-**deleting**
  erasure: the trail is emptied and the record of why remains. The trade-off: a crash between the
  deletes and the audit write loses the trace, which surfaces as `audited: false`.
- **Status mapping.** `200` on a complete, audited erasure; **`207`** when it stopped early
  (`resumable: true`) or the `data.erased` write failed: "mostly erased" and "erased with no record"
  are degraded outcomes a caller must act on, not green results; **`409`** when `"delete"` was asked
  for without `ERASE_AUDIT_FORCE=1` (nothing at all was erased — the floor is checked before the first
  delete); `404` unknown org/repo, `503` no DB.

## Return shape (`PurgeSummary`)

```ts
{
  orgsProcessed: number,
  scansDeleted: number,
  dimensionsDeleted: number,
  recommendationsDeleted: number,
  recommendationEventsDeleted: number,
  auditDeleted: number,
  digestsWritten: number,      // ScanDigest rows the fold created or updated (0 with compaction off)
  scansCompacted: number,      // scans that were folded before they were deleted
  digestsDeleted: number,      // digests aged out past retentionDigestMonths
  digestsWouldWrite: number | null,  // dry run only; null = past the preview cap, i.e. NOT counted
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
| `src/lib/db/retention.test.ts` | Policy + purge + erasure + compaction tests. |
| `src/lib/db/scan-digest.ts` | The digest fold (pure), the in-transaction upsert, the tail read, digest ageing, and `getCompactionCoverage`. |
| `src/lib/db/scan-digest.test.ts` / `scan-digest-read.test.ts` | The pure fold's exactness + the persistence half. |
| `src/components/report/TrendChart.CompactedBand.tsx` | The dashed-run path split, the legend, and the compacted tooltip lines. |
| `src/features/admin/settings/DataErasureCard.tsx` | Org-settings entry point: owns the erase request, and the preview hook that arms the confirmation. |
| `src/features/admin/settings/DataErasureDialog.tsx` | The arming dialog: destroyed/kept manifest, typed confirmation, preview-gated confirm button. |
| `src/features/admin/settings/DataErasurePreview.tsx` | `preview: true` fetch (re-run on disposition change) + the counts panel; unknown-on-failure, never zeros. |
| `src/lib/db/audit-integrity.ts` | Per-row HMAC signing, and `redactAuditIdentity` — the identifier-only rewrite an erasure applies. |

## Known gaps

- **With no retention env set, nothing is deleted**: existing deployments keep all history by default
  (opt-in), and **compaction is off by default** on top of that, so an existing purge is byte-for-byte
  unchanged. An operator who wants a bounded scan table *and* a long trajectory now has a third
  option — `RETENTION_COMPACT=1`, which keeps the timeline as digests rather than choosing between
  storage and history. On-demand erasure (above) does not depend on a policy.
- **A compacted point is not a scan, and cannot be turned back into one.** It carries no permalink,
  no per-dimension evidence, no recommendations, no head sha, and its `overallMin`/`Max` are a range
  within the period, **not** a measured noise band. Surfaces that read retained scans only — the org
  rollup trend, the plan simulator, delivery trends, skill outcomes and the compare picker — still do;
  wiring them to the tail is a follow-on, and the per-repo reader plus `getCompactionCoverage` are
  what it needs.
- **The per-dimension small-multiples on `/trends` cover retained scans only.** The lazy
  `/api/history` fetch behind them does not request the tail (the client-side history validator does
  not yet carry the `compacted` flag through), so the page says so above the grid rather than letting
  the two charts disagree silently.
- **Redaction rewrites `meta` wholesale, not field-by-field.** Identifier-only erasure keeps
  *action + timestamp + tenant* and drops the entire payload, because `AuditLog.meta` is one
  free-form JSON string with no schema separating a subject reference from operational detail.
  Preserving the non-identifying half would need `meta` split into typed columns (or a
  `subjectRef`/`subjectDetail` pair) — a schema migration plus a per-action classification of which
  keys identify a person. Until then the surviving row is deliberately minimal.
- **Erasure keeps the tenant's shell**: `Organization`, `Repository`, `Membership` and
  owner-authored config rows survive an erase; there is no "close the account" endpoint yet.
- **Cron schedules live in deploy config** (`vercel.json` / dashboard), not in code; this
  doc covers the handler and purge mechanics, not the cadence.
- The round-robin rotation's "every org reached within N ticks" guarantee assumes exactly one
  tick per calendar day and a stable org population; more-than-daily scheduling or heavy org
  churn degrade it back to best-effort.
