> Total: 5 findings (1 critical, 2 high, 0 medium, 2 low)

# Scan Persistence & History — combined bug+ui scan

## 1. Degraded-mock (and low-coverage) scans are persisted, then re-served cross-instance for up to 7 days
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: degraded-mock persistence / data integrity
- **File**: src/lib/db/scans-persist.ts:57 (entry `persistScanReport`); callers src/app/api/scan/route.ts:213,233 and src/app/api/scan/stream/route.ts:170,183
- **Scenario**: An LLM scan is requested (`::llm` key) but a transient Gemini/Bedrock blip (429/timeout/unusable reply) degrades the run to `MockProvider`. Both scan routes correctly detect this (`degradedToMock = report.engine.provider === "mock" && !opts.mock`) and SKIP the in-memory `cacheSet`, AND skip caching when `report.confidence < 0.5` (low coverage). But the very next branch calls `persistScanReport(report, …)` **unconditionally** whenever `isDbConfigured()`. The deterministic-floor report (or the degraded low-coverage report) is written as a real `Scan` row. `lookupCachedScan` then has a persistent tier (`getScanReportByCommit`) that re-serves any persisted scan for `scanMaxCacheAgeMs()` (default 7 days) to EVERY instance — exactly the cross-instance poisoning the in-memory skip was meant to prevent, just via the DB instead of RAM.
- **Root cause**: The "don't pin a degraded snapshot" guard was applied only to the volatile in-memory cache, not to the durable store that backs the same lookup. Persistence has no notion of "this report didn't come from the requested engine."
- **Impact**: A single upstream LLM hiccup pins the deterministic floor (no AI nuance) under `owner/repo@sha::llm` in the database; for up to a week every later scanner of that commit — and the report permalink, history trend, and public gallery — serves the mock floor as if it were a real AI scan. Self-correcting only after the 7-day staleness gate or a `fresh=1` re-test. Also persists low-coverage/transient-failure snapshots the cache layer deliberately rejects.
- **Fix sketch**: Mirror the cache guard at the persist call site: in both routes pass the degrade/low-coverage signal (e.g. `persistScanReport(report, { …, skipScanRow: degradedToMock || lowCoverage })`) and have the persist path still advance repo metadata/head pointer + ETag but NOT insert a `Scan` row in that case; or gate the `persistScanReport(...)` call behind `!degradedToMock && !lowCoverage` exactly like `cacheSet`. (The persist module can't infer "degraded" from `engine.provider==="mock"` alone — it can't see `opts.mock` — so the flag must come from the caller.)

## 2. Persisted headSha is the TREE object SHA on PR-gate and sha-less scans — breaks permalinks, dedup, and the cross-instance cache
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: headSha stamping (commit vs tree sha) / dedup integrity
- **File**: src/lib/db/scans-persist.ts:71,127,193 (stores `report.repo.headSha`); root cause src/lib/github/source.ts:389 (`repoMeta.headSha = treeRes.sha`) + src/lib/scan.ts:152-153
- **Scenario**: `fetchSnapshot` stamps `repoMeta.headSha = treeRes.sha`, where `treeRes` comes from `GET /repos/.../git/trees/{ref}` — that response's `sha` is the **tree object SHA, not the commit SHA**. `scan.ts` only overwrites it with the true commit sha on the `!opts.ref && opts.headSha` path (anonymous default-branch scan where `lookupCachedScan` resolved a real commit sha via `resolveHead` → `commits/HEAD`). For a **PR-gate scan** (`opts.ref` set, from `/api/app/webhook`) the override is skipped, and for a **sha-less anonymous scan** (head lookup failed → `opts.headSha` undefined) there is nothing to override. In both cases `persistScanReport` writes the tree sha into `Scan.headSha` (and the repo head pointer).
- **Root cause**: The tree API's `sha` was treated as the commit identity; the commit-sha correction in `scan.ts` covers only one of the three ingestion paths.
- **Impact**: The `/report/{owner}/{repo}@{sha}` permalink and history deep-links point at a sha that is not a real commit (GitHub commit link 404s; `getScanByCommit` dedup keyed on the commit sha never matches, so a re-scan of the same PR head double-inserts instead of deduping; the `@@unique([repoId, headSha])` backstop keys on the wrong value). On the PR-gate path the gate's "scored commit" identity is wrong.
- **Fix sketch**: Stamp the COMMIT sha, not the tree sha — on the `opts.ref` path resolve the ref to its commit sha (the `commits?sha=ref` list already fetched carries `commitsRes[0].sha`, or call `resolveHead`/`commits/{ref}`) and set `snapshot.meta.headSha` to it before persist; keep tree sha only for the tree fetch. Until fixed, do not let a tree sha flow into `Scan.headSha`.

## 3. Pinned old-commit permalink shows the repo's CURRENT contributors, not the contributors as of that scan
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: history reconstruction / data correctness
- **File**: src/lib/db/scans-read.ts:639-642,675-712 (`getScanReportByCommit`)
- **Scenario**: `getScanReportByCommit(owner, name, { headSha })` loads a specific (possibly old) scan's dimensions/recommendations correctly, but reads contributors from `repo.contributors` — the `RepoContributor` set, which `persistScanReport` REPLACES wholesale on every scan (it's a per-repo latest-scan snapshot). So a permalink to a 3-month-old commit renders today's top-50 contributors, and the derived `aiUsage.detected` / `aiUsage.commitFraction` (computed from those contributors) reflect the latest scan, not the pinned one.
- **Root cause**: Contributors are stored as a mutable latest-scan snapshot on `Repository`, but the pinned-snapshot reconstruction treats them as if they belonged to the specific `Scan` being loaded.
- **Impact**: A shared/commit-pinned report and its AI-usage headline silently show wrong, time-shifted people data; trend/compare narratives built on "who contributed at this scan" are inaccurate. Not a crash and partly a known storage tradeoff, but it makes the permalink claim to be a faithful snapshot when the contributor section isn't.
- **Fix sketch**: Either persist contributors per-Scan (a `ScanContributor` join, or carry the set on the Scan graph) so a pinned read returns that scan's people; or, short of a migration, only surface contributors/aiUsage in `getScanReportByCommit` when the loaded scan IS the latest (no `headSha`, or `headSha === repo.headSha`) and omit/blank them for an older pin so the report doesn't assert stale data.

## 4. Sha-less dedup keys on exact `scannedAt` equality — a re-score sharing the injected timestamp is silently dropped
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: dedup / silent data loss
- **File**: src/lib/db/scans-read.ts:52-66 (`findScanByScannedAt`); used at src/lib/db/scans-persist.ts:156
- **Scenario**: When a report has no resolvable commit sha, dedup falls back to matching on the report's own `scannedAt`. `scannedAt` is the injectable `opts.now` in `scanRepository` (`new Date().toISOString()`, or a caller-supplied value). A caller/test that pins `now` (or any path that reuses a timestamp across two genuinely distinct sha-less scores) will have the second, legitimately-new scan suppressed and the first row returned as `deduped`, losing the new result.
- **Root cause**: A high-precision timestamp is used as an idempotency key on the sha-less path; the module's own comment flags this as "inherently fragile." Correctness depends on every distinct re-score carrying a strictly-later timestamp, which is not guaranteed when `now` is injected or reused.
- **Impact**: Rare in production (live scans use wall-clock ms), but a fixed/seeded `now` or coalesced re-run can drop a real re-score with no error — it reports success and returns the prior scan. Bounded to sha-less reports only.
- **Fix sketch**: Use a content/idempotency key for the sha-less path (hash of overallScore+dimensions+roadmap, or a caller-supplied idempotency token) rather than exact-timestamp equality; or scope the timestamp dedup to a short window AND require report-content equivalence before treating it as a dup.

## 5. `lastScanAt`-based head-pointer recency guard can tear headSha/headEtag against a same-timestamp concurrent scan
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: concurrency / head-pointer integrity
- **File**: src/lib/db/scans-persist.ts:126-136 (head-pointer `updateMany` guard)
- **Scenario**: The head pointer advances only when `lastScanAt < scannedAtDate` (`OR lastScanAt IS NULL`). Two scans of the same repo at the SAME `scannedAt` (injected `now`, or a cron batch that stamps one timestamp) and DIFFERENT heads: the first sets `lastScanAt = scannedAt` + its head; the second's guard is `lt` (strict), so on a tie it no-ops and its head is dropped — or, across instances, neither wins deterministically. The guard protects against rollback by an OLDER scan but not against two equal-timestamp writers disagreeing on the head.
- **Root cause**: Recency is decided purely on `lastScanAt` with a strict `<`; equal timestamps are not ordered, so the "newest head" among ties is arbitrary.
- **Impact**: The durable conditional-rescan hint (`headSha`/`headEtag`) can end up pointing at a different commit than the latest persisted `Scan`, making the next `If-None-Match` re-validate the wrong commit. Narrow (requires equal `scannedAt`), self-heals on the next fresh head lookup, and headSha/headEtag still move together within one writer so they don't tear against each other — hence low.
- **Fix sketch**: Order the head pointer on a monotonic, unique-enough key (e.g. advance when `scannedAt > lastScanAt OR (scannedAt = lastScanAt AND <newer createdAt/id>)`), or set the head pointer inside the same per-repo lock / scan transaction that writes the authoritative latest Scan so the pointer always matches the row it was derived from.
