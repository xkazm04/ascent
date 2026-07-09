# Scan Persistence & History — bug-hunter + ui-perfectionist scan

> Context: Scan Persistence & History (group: Data & Persistence)
> Files scanned: 5
> Total: 7 findings (Critical: 0, High: 0, Medium: 3, Low: 4)

Backend-only context (DB persistence/read helpers). Applying both lenses, this skews entirely bug-hunter; there are no UI files, so 0 UI findings are reported (not invented). This module carries dense prior-fix commentary, so residuals are mostly Low with a few Medium consistency gaps.

## 1. Head pointer is advanced before (and outside) the scan-graph transaction
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: atomicity-gap
- **File**: src/lib/db/scans-persist.ts:154
- **Scenario**: A brand-new commit is scanned. The `repository.updateMany` head-advance (`headSha`/`headEtag`/`lastScanAt`) commits at line 154, then the scan-graph `$transaction` (line 226, inside `withRepoLock` at 167) throws a non-retryable error and rolls back. The repo now advertises a `headSha` with no persisted Scan row.
- **Root cause**: The "atomic persist" guarantee (doc lines 56-60) covers scan+contributors+audit, but the head pointer is a separate earlier commit — persistence is assumed to be all-or-nothing when it isn't.
- **Impact**: `getHeadHint` (scans-read.ts:97) returns the phantom head+etag → next conditional re-scan gets a 304 and treats the repo as "up to date," while `getScanReportByCommit`/history still return the older scan. `lastScanAt` also lies ("up to date"). Read/scan consistency broken until a later scan happens to succeed.
- **Fix sketch**: Fold the head-pointer advance into the same `$transaction` as the scan insert (or run it only after the tx returns), so a rolled-back scan never leaves an advanced head.

## 2. Public gallery 500s on a DB-down instead of falling back to static examples
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/scans-read.ts:639
- **Scenario**: `DATABASE_URL` is set but the DB is briefly unreachable. A visitor loads the `force-dynamic` landing page → `getPublicScanGallery` → `resolveOrgId` (line 639) / `loadPublicGalleryCards` `getPrisma().findMany` (line 569) throw `PrismaClientInitializationError`.
- **Root cause**: These reads are NOT wrapped in `dbReadSafe`, unlike the sibling `getHeadHint` (line 108) and `getRepoPassport` (line 134) that were hardened against exactly this. The documented "fall back to static examples" (lines 628-629) only triggers on a `null` return, and a DB-down throws rather than returns null.
- **Impact**: A transient DB blip 500s the public homepage instead of degrading to its static rail — the exact regression already fixed for the head-hint path, reintroduced here.
- **Fix sketch**: Wrap the `resolveOrgId` + gallery load in `dbReadSafe(async () => {...}, null)` so a DB-down returns null and the static fallback engages.

## 3. Pinned snapshot recomputes posture instead of reading the stored column
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: snapshot-integrity
- **File**: src/lib/db/scans-read.ts:888
- **Scenario**: A `/report/owner/repo@sha` permalink reconstructs a historical scan. `posture` is recomputed via `postureFor(scan.adoptionScore, scan.rigorScore)` rather than read from the persisted `scan.posture` column (which persist wrote at scans-persist.ts:250 and which `loadComparableScan` at line 347 does read).
- **Root cause**: The reconstruction assumes derived fields are frozen. `postureFor` thresholds live in the evolving `maturity/model` — if they're ever tuned, every old "pinned" report silently re-postures.
- **Impact**: A shareable, supposedly-immutable permalink drifts from what was originally computed; the comparison view (uses stored posture) and the report view (recomputes) can disagree about the same scan.
- **Fix sketch**: Read `scan.posture` in the select and use it directly, mirroring `loadComparableScan`; keep `postureFor` only as a fallback for legacy rows missing the column.

## 4. Head-advance strict `<` guard drops a newer commit that shares a scannedAt
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/db/scans-persist.ts:157
- **Scenario**: Two distinct commits of one repo are scanned with an identical `scannedAt` (coarse clock, a backfill/import batch). The second persists its Scan row, but the head-advance `where: { lastScanAt: { lt: scannedAtDate } }` is false (equal, not less) → `headSha` is NOT moved to the newer commit.
- **Root cause**: Recency is keyed only on `lastScanAt` with a strict `<`, assuming timestamps are unique — the same non-unique-timestamp assumption `SCAN_ORDER` was added to defend elsewhere.
- **Impact**: `getHeadHint` serves the older commit's sha; the newer commit's scan exists but isn't the discoverable head, so a conditional re-scan validates against the wrong commit.
- **Fix sketch**: On a timestamp tie, also advance when the stored `headSha` differs and this row is the genuinely-latest (tie-break by createdAt/id), or compare against the current head row rather than only `lastScanAt`.

## 5. PersistResult.failures is a permanently-zero success-theater field
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: success-theater
- **File**: src/lib/db/scans-persist.ts:413
- **Scenario**: A caller inspects `result.failures.audit` / `.contributors` to detect a partial write. Every return path hardcodes `{ audit: false, contributors: 0 }` (lines 183, 194, 413).
- **Root cause**: Persistence became atomic (partial failures now throw), but the `failures` field was retained "for backward compatibility" — it can now never be non-zero, so any code still branching on it is dead/misleading.
- **Impact**: A caller relying on `failures` to warn on partial persistence gets false reassurance forever. Minor, but it's a latent lie in the public type.
- **Fix sketch**: Remove `failures` from `PersistResult` (or document it as always-empty and delete callers' checks) so success/failure is expressed only by resolve-vs-throw.

## 6. syncTechStackGroups failure is swallowed with no log or metric
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/scans-persist.ts:411
- **Scenario**: `syncTechStackGroups(...).catch(() => {})` discards every error unconditionally. A persistent misconfiguration (bad schema, permission error) fails silently on every scan.
- **Root cause**: "Best-effort, self-corrects next scan" assumes failures are transient; a permanent failure is invisible with no `console.warn`, unlike other best-effort paths here that at least log (e.g. the private-repo refusal at line 86).
- **Impact**: Tech-stack group memberships silently never populate; no signal to operators. Display-only, hence Low.
- **Fix sketch**: `.catch((e) => console.warn("[scans-persist] tech-group sync failed", e))` so a durable failure surfaces without breaking the persist.

## 7. Explicit beforeId newer than afterId bypasses the forward-baseline guard
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/db/scans-read.ts:445
- **Scenario**: A comparison link (or dropdown selection) passes a valid `beforeId` that is chronologically NEWER than `afterId`. Line 445 honors any `beforeId` in the repo's scan set; the forward-reach guard at lines 439-443 only protects the DEFAULT baseline.
- **Root cause**: The invariant "before is older than after" is enforced for the computed default but not for an explicit baseline, assuming callers always pass a chronologically-earlier before.
- **Impact**: Every delta in the "what changed" view reads backward — a real improvement renders as a regression — for a stale/hand-built link or an inverted dropdown pick.
- **Fix sketch**: After resolving both ids, if `before`'s scannedAt is not older than `after`'s, swap them or null out `before`, so the diff's time axis can't invert regardless of input.
