# Scan Persistence & History — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 1, High: 3, Medium: 1, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 4

This is a pure backend persistence/read layer (no JSX, no render) — every finding is bug-hunter; ui-perfectionist has nothing to flag. Cross-referenced `prisma/schema.prisma`, `lib/db/client.ts`, and `lib/report/compare.ts` to confirm constraints and round-trips.

## 1. Concurrent persist of the same commit double-inserts — no unique constraint backs the read-then-insert dedup
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: concurrent-persist / duplicate row
- **File**: src/lib/db/scans-persist.ts:123-141 (dedup read) + :164-225 (insert); schema `Scan` model prisma/schema.prisma:269-307
- **Scenario**: Two serverless instances (or a cold instance + a warm one) persist a scan for the **same repo at the same `headSha`** concurrently — a double-submit that load-balanced across instances, or a cron rescan batch overlapping an on-demand scan. Instance A runs `findScanByCommit(repo.id, headSha)` → null, instance B runs the same → null (the row isn't committed yet). Both fall through and `tx.scan.create(...)`. Two Scan rows now exist for the identical commit.
- **Root cause**: Dedup is a non-atomic **read-then-insert** (`findScanByCommit` at :127, then a separate `$transaction` insert at :164). The only thing serializing it is `withRepoLock` (scans-shared.ts:146-160), which the code itself documents as *"best-effort and process-local"* — it does not coordinate across instances. Crucially, the `Scan` table has **no unique constraint** on `[repoId, headSha]` — only a plain `@@index([repoId, headSha])` (schema :306). So unlike the repo/org upserts (which lean on `upsertRacing` + a real `@@unique`), the loser of a same-commit race gets **no P2002** to recover from — both inserts simply succeed. `withRetry` can't help either: there's no conflict to retry.
- **Impact**: Duplicate scans for one commit. Every downstream "latest"/`findFirst orderBy scannedAt desc` read (`getScanReportByCommit`, `getLatestRecommendations`, the gallery's `take:1`) becomes non-deterministic between the two rows; the trend/history shows two points for one commit; and the very dedup the `deduped` flag promises (no "double usage-based billing", per the `PersistResult` doc at :20-21) is defeated — both scans bill. This is the headline persist-correctness hole.
- **Fix sketch**: Add `@@unique([repoId, headSha])` to `Scan` (partial/where-not-null, since `headSha` is nullable) and wrap the `tx.scan.create` in `upsertRacing`: on P2002, re-read via `findScanByCommit` and return it as `deduped: true`. The process-local lock then becomes the fast path and the constraint the cross-instance backstop — exactly the pattern already used for `Repository`/`Organization`.

## 2. `getScanReportByCommit` rebuilds a HISTORICAL pinned report with the CURRENT contributor set
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: row<->report mapping loss / stale-join on by-commit read
- **File**: src/lib/db/scans-read.ts:617-621 (repo include) + :653-687 (report assembly)
- **Scenario**: A user opens a permalink to an **old** scan — `/report/{owner}/{repo}@{oldSha}`. `getScanReportByCommit` finds the correct historical `scan` row by `headSha` (:623-628), but pulls contributors from `repo.contributors` (the `include` at :619), which is the repo-level **latest-scan snapshot**.
- **Root cause**: `RepoContributor` is a per-repo LATEST snapshot, replaced wholesale on every persist (`deleteMany({ where: { repoId } })` + `createMany`, scans-persist.ts:240-250) — it is keyed by `repoId`, never by `scanId` (schema :233-247), so there is no per-scan contributor history to read. The reconstruction then derives `aiUsage.detected` and `commitFraction` from those current contributors (:661-662, :683-686). So a pinned report for commit X at L2 shows commit/AI-attribution numbers from the most recent commit Y scan.
- **Impact**: Pinned/shareable permalinks and the by-commit comparison silently misreport their contributor list and AI-usage fraction — the headline "X% AI-authored" on a historical report reflects *today's* repo, not the pinned snapshot. The report claims to be commit-pinned (:675 sets `repo.headSha` from the historical scan) but its contributor-derived fields are not. Reproducible whenever a repo has ≥2 scans with different contributor sets.
- **Fix sketch**: Either (a) persist contributors per-scan (add `scanId`, or a `ScanContributor` child of the scan graph) and read them by the resolved `scan.id`; or (b) if historical contributor accuracy is out of scope, stop deriving `aiUsage`/contributors from the latest snapshot on a *pinned* read — return them as empty/unknown rather than mislabeled. Document the chosen contract.

## 3. `findScanByScannedAt` dedup collides across genuinely different scans on a millisecond tie
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: latest-vs-by-commit / false-positive dedup
- **File**: src/lib/db/scans-persist.ts:131-141 + src/lib/db/scans-read.ts:51-60
- **Scenario**: Two **sha-less** reports for the same repo (head resolution failed, or reconstructed snapshots) are computed and persisted with the **same `scannedAt`** — the report's `scannedAt` is an ISO **string** (`types.ts:341`) truncated/rounded to whatever the producer stamped, and coalesced followers / a retried lane explicitly reuse one computed report (the documented dedup case at :132-140). `findScanByScannedAt` matches on **exact `Date` equality** with no `repoId+headSha` discriminator and no `headSha` filter, so the second genuinely-distinct sha-less scan is wrongly deduped onto the first and **never persisted**.
- **Root cause**: The fallback dedup key is `(repoId, scannedAt)` alone (read.ts:56-59), `findFirst` with **no `orderBy`** — so on any tie it returns an arbitrary matching row. There's no `@@unique` to make this safe and no second field (commit, headline hash, score) to distinguish a true re-persist from a coincidentally co-timestamped different scan. The persist-side comment assumes "a genuinely new re-score carries a later scannedAt" (:135-136), but nothing enforces monotonic `scannedAt` — a backdated/clock-skewed or batch-stamped report breaks the assumption.
- **Impact**: Silent scan loss for sha-less reports that share a timestamp; and because the `findFirst` has no `orderBy`, *which* row a legitimate re-persist dedups onto is non-deterministic. Narrower than #1 (sha-less path only) but it drops data rather than duplicating it.
- **Fix sketch**: Make the sha-less dedup key more specific — match on `(repoId, scannedAt)` **plus** a content discriminator (e.g. `overallScore` + a hash of `headline`), and add a deterministic `orderBy: { createdAt: "desc" }`. Better: derive a synthetic dedup key (content hash) and store it so the constraint approach from #1 applies uniformly.

## 4. Repo head pointer + ETag are written before dedup and outside the lock — a stale/no-op scan clobbers a newer head
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: latest-vs-by-commit race / last-writer-wins overwrite
- **File**: src/lib/db/scans-persist.ts:82-117 (repo upsert) vs :123-141 (dedup, run *after*)
- **Scenario**: The repo `upsert` — which writes `headSha`, `headEtag`, `lastScanAt`, `stars`, etc. — runs **before** the per-repo lock and **before** dedup (:92-117), unconditionally. Case A: a scan of an **older** commit lands (a delayed cron job, a replayed/retried request) after a newer commit's scan already set `headSha`. The older scan's `upsert` overwrites `headSha` back to the **older** commit with no ordering guard (last-writer-wins). Case B: a scan that will turn out to be a **dedup no-op** (`deduped: true`, no new row) still rewrites the repo's `headEtag`/`lastScanAt` first — a redundant hot-row write the dedup path was meant to avoid.
- **Root cause**: The head-pointer write is sequenced ahead of the dedup/lock section deliberately (comment at :79-81, :124-125 "repo metadata already refreshed so the UI shows up to date"), but there is **no scan-recency guard** — the update sets `headSha`/`headEtag`/`lastScanAt` regardless of whether this report is newer than what's stored. `getHeadHint` (read.ts:69-85) then serves a stale/older `headSha`+`etag` pair as the conditional-request hint.
- **Impact**: `getHeadHint` can hand back an **older** commit's sha with a **newer** commit's ETag (or vice-versa) — a torn head pointer — making the next conditional re-scan send `If-None-Match` for the wrong commit and either 304-skip a real change or re-scan unnecessarily. The "up to date" UI lastScanAt can also move backwards. Cross-instance, no lock covers this write at all.
- **Fix sketch**: Guard the head-pointer fields with a recency condition — only advance `headSha`/`headEtag`/`lastScanAt` when `report.scannedAt > repo.lastScanAt` (a conditional update or `updateMany` with a `lastScanAt <` predicate), and skip the head-pointer rewrite entirely on the dedup/no-op path. At minimum, keep `headSha` and `headEtag` updated together atomically so they can't tear.

## 5. Carry-forward "previous scan" select is non-deterministic under equal `scannedAt` and pulls from a duplicate
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: history ordering / carry-forward correctness
- **File**: src/lib/db/scans-persist.ts:150-159
- **Scenario**: The carry-forward of recommendation status/assignee/due-date reads `previous = prisma.scan.findFirst({ where: { repoId }, orderBy: { scannedAt: "desc" } })` (:150-154). If finding #1 already produced two rows for one commit (or two re-scans share a `scannedAt`), `orderBy scannedAt desc` has a **tie with no tiebreaker**, so "previous" resolves to an arbitrary one of the duplicates. Worse, on the very first scan of a fresh re-score, "previous" can resolve to a row that itself was a partial/duplicate of the current commit.
- **Root cause**: The ordering key `scannedAt` is not unique (no `createdAt`/`id` secondary sort), and the query doesn't exclude rows for the *current* `headSha` being persisted — so under the duplicate condition from #1, or any equal-timestamp pair, the matcher (`matchRecommendations`, compare.ts:118) carries state forward from a non-canonical predecessor. Because match tier 3 (compare.ts:147-168) pairs lone same-dimension items, a wrong predecessor can mis-carry a tracked status/assignee onto a different gap.
- **Impact**: Tracked backlog state (status, assignee, due date) can be carried from the wrong prior scan, or reset, when timestamps tie or duplicates exist — the planning-state loss the carry-forward was explicitly built to prevent (:143-149). Probability is low without #1, but #1 makes it reachable.
- **Fix sketch**: Add a deterministic tiebreaker — `orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]` — and once #1's uniqueness is in place, optionally exclude the current commit's own row from the "previous" lookup so a same-commit re-score carries from the true prior commit.
