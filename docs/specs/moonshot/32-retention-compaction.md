# 32 — Retention compaction: pruned scans age into rubric-tagged digests

size L · effort 6 / impact 7 / risk 4 · gate: contract · lane **W1-F** · wave 1

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/db/retention.ts` — fold-then-delete inside `pruneRepoScans`; digest counts on
  `OrgPurgeResult`/`PurgeSummary`; digest pruning per `retentionDigestMonths`; digest deletion in
  the erase path (`eraseOrgData`/`eraseRepo`).
- `src/lib/db/scans-read.ts` — `HistoryPoint.compacted`/`scanCount`; `getRepositoryHistory` gains
  `includeCompacted`; digest tail appended after the real scans.
- `src/lib/maturity/forecast.ts` — `SeriesPoint.compacted?`, `Forecast.compactedPoints`,
  `forecastBasis(f)`.
- `src/app/api/history/route.ts` — `?compacted=1` passthrough + a `compacted` CSV column.
- `src/app/trends/page.tsx` — request the compacted tail for the overall chart.
- `src/components/report/TrendChart.tsx` — `TrendPoint.compacted?`; dashed segment + hollow point.
- `src/components/report/DimensionTrends.tsx` — map `compacted` through to `TrendPoint`/`ScanMeta`,
  legend line.
- `src/lib/db/retention.test.ts`, `src/lib/db/scans-read.test.ts`,
  `src/lib/maturity/forecast.test.ts`, `src/app/api/history/route.test.ts`,
  `src/components/report/TrendChart.dom.test.tsx`.
- `docs/features/data/retention.md` (the lane's doc-sync obligation).

**Files to create**
- `src/lib/db/scan-digest.ts` — the pure fold + the digest reader/writer.
- `src/lib/db/scan-digest.test.ts` — pure-fold unit tests.
- `src/lib/db/scan-digest-read.test.ts` — tail-read + coverage-helper tests.

**Prisma models/columns needed (landed by the wave-1 schema pass, NOT by this lane)**

```prisma
model ScanDigest {
  id             String   @id @default(uuid())
  repoId         String
  period         String   // UTC month bucket "YYYY-MM" (digestPeriod)
  rubricVersion  String   // "unknown" sentinel for legacy rows — NEVER null (see keys below)
  engineProvider String
  scanCount      Int
  overallSum     Int      // sums, not means: an upsert folds a later page exactly
  adoptionSum    Int
  rigorSum       Int
  overallMin     Int
  overallMax     Int
  overallLast    Int
  adoptionLast   Int
  rigorLast      Int
  confidenceSum  Float
  levelLast      String
  levelNameLast  String
  postureLast    String
  firstScannedAt DateTime
  lastScannedAt  DateTime
  firstHeadSha   String?
  lastHeadSha    String?
  enginesJson    String   @default("[]") // JSON string[] of distinct engineModel values
  dimensionsJson String   @default("{}") // JSON {dimId:{sum,n,last,signalSum,llmSum}} — TEXT, never jsonb
  recsOpened     Int      @default(0)
  recsClosed     Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  repo Repository @relation(fields: [repoId], references: [id])

  @@unique([repoId, period, rubricVersion, engineProvider])
  @@index([repoId, lastScannedAt])
}
```

- `Organization.retentionCompact Boolean?` (null = inherit env `RETENTION_COMPACT`, default `false`).
- `Organization.retentionDigestMonths Int?` (null = inherit env `RETENTION_DIGEST_MONTHS`;
  `0` = keep digests forever — the module's existing 0-sentinel, unchanged).
- `Repository.digests ScanDigest[]` back-relation.
- `src/lib/db/wire-safe-dates.test.ts`: add `CompactedPoint` (and the already-listed `HistoryPoint`
  stays valid — the new fields are `string`/`number`/`boolean` only).

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: `export { getCompactionCoverage, digestPeriod, digestScans, type CompactedPoint, type ScanDigestRow } from "@/lib/db/scan-digest";`
- `context-map.json` → *Data & Persistence › Data Retention & Purge* `filePaths`:
  `src/lib/db/scan-digest.ts`, `src/lib/db/scan-digest.test.ts`, `src/lib/db/scan-digest-read.test.ts`.
- `scripts/docs/feature-doc-map.json` → the `data`/`retention.md` entry gains
  `src/lib/db/scan-digest*.ts`.

**MUST NOT TOUCH**
`prisma/schema.prisma`, `prisma/init.sql`, the PGlite reconcile, `src/lib/db/wire-safe-dates.test.ts`,
`src/lib/db/index.ts`, `context-map.json`, `scripts/docs/feature-doc-map.json` (all Class B —
requested above). **`src/lib/org/briefing.ts` is W2-G's** — this lane ships the read helpers G calls
and never edits that file. Also untouched: `src/lib/db/org-rollup.ts` (the org trend), `plan.ts`,
`personal.ts`, `org-delivery-trend.ts`, `src/lib/org/skill-outcomes*.ts`.

**Handoffs to other lanes**
- **W2-G (#26, briefing):** call `forecastBasis(forecast)` for the trajectory basis clause and
  `getCompactionCoverage(orgSlug)` for the "timeline extends N months beyond retained scans" line.
  Both ship green from this lane; G owns the wording in `briefing.ts`.
- **Director / a later lane:** `getOrgRollup`'s trend and `skill-outcomes` do **not** read the
  compacted tail in this lane (both live outside W1-F's write set). Dossier item dropped
  deliberately — see *Out of scope*.

## Goal

Retention stops being a choice between "keep every `Scan` row forever" and "delete the timeline that
trends, forecasts and skill-outcome deltas stand on": a purged page of scans is folded into a
`ScanDigest` — one row per repo × month × rubric version × engine provider — inside the same
transaction that deletes it, and readers serve that tail explicitly labelled `compacted`.
*Competitive angle:* nobody in DX/Swarmia/Sonar versions their instrument, so nobody else can offer
data-minimal retention that still yields a rubric-honest two-year trajectory.

**Known gaps this deletes** — `docs/features/data/retention.md` § *Known gaps*: the first bullet
("with no retention env set, nothing is deleted … existing deployments keep all history by default")
is rewritten, not deleted, to state the new default (compaction off, behaviour unchanged) plus the
new opt-in. The doc's `purgeExpiredData()` mechanics list gains the fold step, and a new
*Compaction* section documents the digest keys, the "unknown" rubric sentinel, and the fact that a
compacted point carries no permalink.

## Behaviour

### Data model and honest-null rules

- **Keys.** `(repoId, period, rubricVersion, engineProvider)` unique. `rubricVersion` is **non-null**
  by construction: legacy scans with `Scan.rubricVersion = null` fold into the literal `"unknown"`.
  Postgres treats NULLs as distinct, so a nullable key column would make the upsert insert a second
  row on every tick — the sentinel exists for the constraint, not to claim knowledge.
- **The sentinel never leaks as knowledge.** `digestToPoint` maps `"unknown"` back to
  `rubricVersion: null` on the wire, so `skill-outcomes.ts`'s `sameInstrument` keeps returning
  `null` ("at least one side is silent") for those points. Silence about provenance stays silence.
- **Sums, not means.** A later purge tick folds more scans of the same period into an existing row;
  storing `*Sum` + `scanCount` makes the merge exact and order-independent. Means are derived on
  read (`overallMean = overallSum / scanCount`, rounded at the render boundary only).
- **`*Last` fields advance only when the folded batch's newest scan is newer than `lastScannedAt`**;
  `firstScannedAt`/`firstHeadSha` only retreat. `overallMin`/`Max` are min/max folds.
- **Idempotency** comes from atomicity: the fold is committed in the same `$transaction` as the
  `deleteMany` that removes its inputs, so a retried batch (DSQL OC###/40P01 via `withRetry`) rolls
  back both halves and re-selects only surviving rows. No scan can be folded twice.
- **Wire safety.** `ScanDigestRow` and `CompactedPoint` declare `firstScannedAt`/`lastScannedAt`/
  `scannedAt` as `string`; the mappers `.toISOString()` server-side (wire-safe-dates guard).
- **JSON columns are TEXT** (`dimensionsJson`, `enginesJson`) — no `jsonb`, per DSQL/PGlite.
- **Unknown ≠ 0.** A dimension absent from every scan in a period is absent from `dimensionsJson`;
  the reader emits no entry for it, so `DimLine` renders a gap, never a zero.

### Pure module — `src/lib/db/scan-digest.ts`

```ts
export function digestPeriod(d: Date): string;                       // UTC "YYYY-MM"
export const UNKNOWN_RUBRIC = "unknown";
export interface DigestInputScan { id: string; scannedAt: Date; headSha: string | null;
  overallScore: number; adoptionScore: number; rigorScore: number; confidence: number;
  level: string; levelName: string; posture: string; rubricVersion: string | null;
  engineProvider: string; engineModel: string;
  dimensions: { dimId: string; score: number; signalScore: number; llmScore: number }[];
  recsOpened: number; recsClosed: number; }
export interface DigestDraft { key: { period: string; rubricVersion: string; engineProvider: string };
  /* every column above, as a fold over one page */ }
export function digestScans(rows: readonly DigestInputScan[]): DigestDraft[];   // pure, no clock
export function mergeDigest(existing: ScanDigestRow | null, draft: DigestDraft): ScanDigestWrite;
export function digestToPoint(row: ScanDigestRow): CompactedPoint;              // pure
export async function upsertDigests(tx, repoId, drafts): Promise<number>;       // in-transaction
export async function readDigestTail(repoId: string, opts: { before?: Date; limit: number }): Promise<ScanDigestRow[]>;
export async function pruneDigests(prisma, repoId, cutoff: Date, batchSize, budgetExceeded?): Promise<number>;
export async function getCompactionCoverage(orgSlug: string):
  Promise<{ repos: number; digests: number; scansCompacted: number; oldestPeriod: string | null; extraSpanDays: number | null } | null>;
```

`digestScans` and `mergeDigest` are clock-free and dependency-free — the unit-test surface.
`getCompactionCoverage` degrades to `null` via `dbReadSafe` like every other reader (never zeros).

### `pruneRepoScans` (retention.ts)

1. Resolve `compact = org.retentionCompact ?? envBool("RETENTION_COMPACT")` once per org and pass it
   into `pruneRepoScans`. **Off by default**, so an existing deployment's purge is byte-for-byte
   what it is today.
2. When `compact`, the page selection widens from `{ id }` to the `DigestInputScan` columns plus
   `dimensions` and the page's recommendation status counts. When `compact` is false the select is
   unchanged (no cost for orgs that opted out).
3. Inside the existing `$transaction`, **before** the deletes: `upsertDigests(tx, repoId,
   digestScans(page))`. The delete order (events → dimensions + recommendations → scan) is unchanged.
4. Counts flow out as `digestsWritten` / `scansCompacted` on the prune result, into `OrgPurgeResult`
   and `PurgeSummary`, and into the `retention.purged` audit `meta` (the compliance trace must say
   what survived, not only what died).
5. **Digest retention:** after the scan prune, `pruneDigests(prisma, repoId, cutoff, …)` where
   `cutoff = now − retentionDigestMonths months`; `0` = keep forever (no call). Budget-polled
   between batches like every other loop here.
6. **Dry run:** with `countOnly`, the preview additionally selects `{ scannedAt, rubricVersion,
   engineProvider }` (three narrow columns, no dimensions) over the same paged stale window, capped
   at `DIGEST_PREVIEW_MAX_SCANS = 5000`, and reports `digestsWouldWrite`. Past the cap it reports
   **`null` (unknown)** — never an estimate (G4). The scan count still comes from the single shared
   `where`, so "the number you were shown is the number that dies" holds.
7. **Erasure erases.** `eraseOrgData` passes `compact: false` (a DSR erase must not mint a summary of
   the data it is erasing) **and** deletes the repo's `ScanDigest` rows in `eraseRepo`, batched,
   counted as `digestsDeleted` on `EraseResult` and in the `data.erased` audit meta.

### Reader — `getRepositoryHistory(owner, name, { includeCompacted })`

- `HistoryPoint` gains `compacted?: true` and `scanCount?: number` (both absent on real scans).
- With `includeCompacted`, after the real scans the reader appends `readDigestTail(repoId, { before:
  oldestRetainedScannedAt, limit })` mapped through `digestToPoint`, newest-first, so the array stays
  one ordered series. `limit` bounds the combined length.
- A compacted point sets **`headSha: null`** even though `lastHeadSha` is stored: the `Scan` row is
  gone, so `reportPermalink` would 404. `id` is `digest:<row.id>` — visibly not a scan id. This is
  the one contract break the finding predicted; the two consumers that derive links from `headSha`
  (`DimensionTrends`, `TrendChart`) therefore draw a compacted point as non-navigable with no change
  to their link logic.
- `overallScore` = the period **mean** (rounded at render), `scannedAt` = `lastScannedAt`,
  `dimensions` = per-dim mean for the dims present, `engineModel` = `"mixed"` when
  `enginesJson.length > 1`, else the single model.
- Default is `includeCompacted: false` — every existing caller (`skill-outcomes-load`, the compare
  picker, `/api/history` without the param) is unchanged.
- `/api/history?compacted=1` opts in; the CSV export gains a `compacted` column (`""`/`"yes"`) and a
  `scans` column, so the audit CSV stays honest about which row is a summary.

### Forecast

`SeriesPoint.compacted?: boolean`; `Forecast.compactedPoints: number` (fitted day-keys that included
at least one compacted observation). `MIN_FORECAST_POINTS`/`MIN_FORECAST_SPAN_DAYS` and the
`lowData` rule are untouched — a compacted day counts as one day, no more. New pure helper:

```ts
export function forecastBasis(f: Forecast): string;
// "fit over 9 scan days across 84 days, 4 of them compacted" — the compaction half is omitted when compactedPoints === 0
```

### UI

`/trends` (report trends page) → `TrendChart` (`@/components/ui` `Surface`, `Kicker`, `EmptyState`
already in place). A compacted run is drawn as a **dashed** polyline segment with hollow points,
reusing the existing hollow-point mock marker geometry and `LEVEL_HEX`/`scoreHex` for colour — no new
palette. One legend line: *"dashed = compacted (period average, N scans, no permalink)"*. Hover
tooltip shows the period, the scan count, and the rubric version. `DimensionTrends` passes
`compacted` into `TrendPoint`/`ScanMeta` and renders the same legend once for the small-multiples
grid. Both files stay under 300 LOC (`TrendChart.tsx` 288 → extract `TrendChart.CompactedBand.tsx`
if it crosses).

### Self-hosted · plan gates · privacy

No plan gate: compaction is a retention mechanic, not a tier feature, and `selfHosted()` turns plan
gates off anyway. No public surface: digests are per-repo and read behind the same org resolution and
the same `orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate` refusal `getRepositoryHistory` already
applies — a private repo's compacted tail is never served from the public org. `CHAMPION_MIN_POP` is
not engaged (no cohort aggregation here). Audit rows: `retention.purged` meta gains
`digestsWritten`/`scansCompacted`; `data.erased` meta gains `digestsDeleted`.

## Build order

1. **Pure fold.** `scan-digest.ts` with `digestPeriod`, `digestScans`, `mergeDigest`, `digestToPoint`
   + `scan-digest.test.ts`. No DB, no callers — landable and gateable alone.
2. **Writer.** `upsertDigests` / `readDigestTail` / `pruneDigests` / `getCompactionCoverage` against
   the schema-pass model; `dbReadSafe` degradation tests.
3. **Purge fold.** `retention.ts`: the `compact` flag, the widened page select, the in-transaction
   upsert, the new counts on `OrgPurgeResult`/`PurgeSummary`/audit meta. Default off ⇒ existing
   `retention.test.ts` stays green unchanged (the regression proof).
4. **Digest retention + erasure.** `pruneDigests` wired to `retentionDigestMonths`; `eraseOrgData`
   deletes digests and never compacts; dry-run digest preview with its cap and `null`.
5. **Reader.** `HistoryPoint.compacted`/`scanCount`, `includeCompacted`, the tail append, the
   `headSha: null` rule; `/api/history?compacted=1` + CSV columns.
6. **Forecast.** `SeriesPoint.compacted`, `Forecast.compactedPoints`, `forecastBasis`.
7. **Chart.** `TrendChart` dashed band + hollow points + legend; `DimensionTrends` passthrough;
   `/trends/page.tsx` requests the tail.
8. **Doc.** `docs/features/data/retention.md`: the compaction section, the mechanics step, the
   rewritten first Known gap, the two new env vars and two new org columns in the policy table.

## Tests

- **New** `src/lib/db/scan-digest.test.ts` — period bucketing across a UTC month boundary; grouping
  by rubric × provider (two rubrics in one month ⇒ two drafts); `mergeDigest` exactness over two
  pages (**fail-before:** a mean-of-means implementation drifts on unequal page sizes); the
  `"unknown"` sentinel in the key and its mapping back to `null` on the wire; a dimension missing
  from every scan produces no entry (**fail-before:** a `?? 0` default emits a zero).
- **New** `src/lib/db/scan-digest-read.test.ts` — tail ordering and the `before` boundary (a digest
  overlapping retained scans is not double-counted); `getCompactionCoverage` returns `null` when the
  DB read fails (**fail-before:** zeros).
- `src/lib/db/retention.test.ts` — compaction **off** by default (existing assertions unchanged);
  on, one prune page writes one digest per (period, rubric, provider) and the digest row survives the
  transaction that deleted the scans; a thrown delete rolls the digest back too (**fail-before:** a
  fold written outside the `$transaction` survives an aborted delete and double-counts on retry);
  `eraseOrgData` writes no digest and deletes existing ones; dry run reports `digestsWouldWrite` and
  `null` past the cap.
- `src/lib/db/scans-read.test.ts` — `includeCompacted: false` is byte-identical to today;
  `true` appends flagged points with `headSha === null` and `id` prefixed `digest:`; the
  private-repo/public-org refusal still applies to the tail.
- `src/lib/maturity/forecast.test.ts` — `compactedPoints` counting; `lowData`/`MIN_FORECAST_POINTS`
  unchanged by compacted observations; `forecastBasis` string in both branches.
- `src/app/api/history/route.test.ts` — `?compacted=1` passthrough; CSV columns.
- `src/components/report/TrendChart.dom.test.tsx` — a mixed series renders exactly one dashed
  segment and the legend only when a compacted point is present.
- **Structural guards touched:** `wire-safe-dates.test.ts` (Director adds `CompactedPoint`);
  doc-sync (`retention.md` in the same turn). `id-routes-gated` is not engaged — no new `[id]` route.
- **UAT journey to re-run:** **Dana** (`M1`, executive briefing) — the trajectory line is the surface
  the basis clause lands on; plus the `/trends` read for **Sam**.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx`;
nothing under `src/features/**` is touched). Done when: compaction is off by default and the existing
retention suite is unchanged; with it on, a purge deletes scans and leaves a digest committed in the
same transaction; `getRepositoryHistory` serves a labelled tail with no permalink; the chart draws
the dashed band; `retention.md` carries the compaction section and the rewritten gap.

## Out of scope (explicitly)

- **#31 Signed tenant history bundle** (deferred) — export/import of a scan series. A digest is not a
  bundle and gets no signature, no export endpoint, no import path here.
- **#29 Score-input ledger** (deferred) — a digest stores *scores*, never scan inputs, and is
  explicitly not a re-score or rubric-migration substrate.
- **#2 Open benchmark corpus** (concept-doc first) — no digest is aggregated across orgs, published,
  or given a percentile; the corpus floors are that doc's to set.
- **#30 Reproducibility certificate** (deferred) — `overallMin`/`Max` inside a period are a range,
  not a measured noise band, and must not be rendered as one.
- **#26 One improvement ledger** (W2-G) — this lane ships `forecastBasis` and
  `getCompactionCoverage`; the briefing wording and `briefing.ts` are G's.
- `getOrgRollup`'s org trend, `plan.ts`, `personal.ts`, `org-delivery-trend.ts` and
  `skill-outcomes.ts` keep reading retained scans only. The dossier's "readable by `getOrgRollup`
  trend" clause is **dropped from this lane** — those files sit outside W1-F's write set, and the
  per-repo reader + the two helpers are what a follow-on needs to wire them.
- No change to `RETENTION_MIN_SCANS_PER_REPO` (5), the `RETENTION_FORCE` hatch, the wall-clock
  budget, or the round-robin rotation. Compaction is not a licence to lower the floor.
