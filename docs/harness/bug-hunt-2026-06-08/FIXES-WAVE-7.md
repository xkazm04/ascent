# Bug Hunter Fix Wave 7 — Cache/dedup correctness & GitHub App sync

> 5 commits, 5 findings closed (1 High + 4 Medium); 3 deferred with cause (2 High + 1 Medium).
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green.
> Branch: `vibeman/bug-hunt-wave1-authz` (continued).

Shared model: a cache entry / installation token / paginated list / cross-boundary payload must reflect *current, complete, correct* state — and degrade loudly, not silently.

## Commits

| # | Commit | Findings | Severity | Files |
|---|---|---|---|---|
| 1 | `50f98ee` | github-app #5 | Medium | `lib/db/installations.ts` |
| 2 | `344aede` | scan-pipeline #3 | High | `api/scan/route.ts`, `api/scan/stream/route.ts` |
| 3 | `8d105d7` | report-trends #4 | Medium | `components/report/ReportClient.tsx` |
| 4 | `e780ee6` | github-app #7 | Medium | `lib/github/app.ts` |
| 5 | `0751b4c` | github-app #6 | Medium | `lib/github/graphql.ts` |

## What was fixed

1. **Token cache survives uninstall (github-app #5)** — the in-memory installation-token cache was never purged on `removeInstallation`, so a cached token could outlive access and a deleted-then-reissued installation reusing the id could be served a stale token. Invalidate it at the top of `removeInstallation` (before the DB guard, so it runs DB-less too).

2. **Transient partial scan cached as authoritative (scan-pipeline #3, High)** — silent per-file fetch failures (raw-host hiccup / `TIMEOUT_FILE_MS`) lower a scan's coverage WITHOUT failing the LLM, so the `degradedToMock` guard didn't apply and the low-coverage report got pinned under the commit key for the full 15-min TTL and served to every later scanner. Skip the cache when `report.confidence < 0.5` (the same floor that already flags the scan "indicative"), on both scan routes — the next scan re-resolves.

3. **Peek wrong-repo + permanent spinner (report-trends #4)** — the `?peek=` fast-path rendered a 200's report without checking it matched the requested repo (a stale/colliding cache entry could show another repo); now it compares the report's `owner/name` to the normalized request and falls through to a fresh scan on mismatch. And a non-timeout `AbortError` (e.g. connection reset) left the checklist spinning forever (error was set only on `timedOut`); now it surfaces "scan was interrupted, please try again".

4. **Pagination truncation is silent (github-app #7)** — `listInstallationRepos` stops at `MAX_PAGES` (5000 repos) with no signal, so a larger install silently drops repos (invisible to watch/scan, wrong "X of N"). Warn when the listed count is below the reported `total_count`. (Full fix = page beyond the cap; this makes the silent case loud.)

5. **GraphQL discards partial data (github-app #6)** — the client threw on ANY `errors`, but GitHub GraphQL returns partial `data` + `errors` when one PR node fails to resolve, so PR ingestion failed over a single bad node. Throw only when there's NO `data`; otherwise log the errors and return what resolved.

## Deferred (with cause)

- **org-scanning #2 (High) — cross-instance duplicate Scan rows.** The fix is a DB-level `@@unique([repoId, headSha])` so the loser fails with P2002 — the same migration deferred as **persistence #4** (risky blind: fails if duplicates already exist; needs a live DB). Tracked there.
- **github-app #4 (High) — installation_repositories removed-handler misses selection-narrowing.** The robust fix reconciles the stored watch-set against a fresh `listInstallationRepos` on any such event — it needs a new "watched repos for installation" query + a GitHub re-list, and is unverifiable DB-less. Deferred.
- **scan-pipeline #5 (Medium) — headSha is the tree sha, not the commit sha, on the no-lookup (tokened/private) path.** A known carried follow-up (PR-ref headSha stamping) already in `harness-learnings`; low priority. Deferred.

## Verification

| Check | Baseline | After Wave 7 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched) | clean |
| `next build` | pass | pass |

Each fix committed atomically after a shared `tsc` pass.

## Cumulative status (waves 1–7)

- **35 findings closed** in 29 fix commits; 1 reassessed (github-app #2); deferred-with-cause now includes org-scanning #2, github-app #4, scan-pipeline #5 (this wave) plus the earlier set.
- **All 9 criticals remain closed.**
- Remaining per INDEX: **Wave 8** (session/OAuth hardening — github-oauth #1/#2/#3/#4/#6 — plus the aggregate/UI tail: org-dashboard #3/#4/#5/#6, org-scanning #5/#6/#7, report-trends #3/#5/#6/#7, scan-pipeline #6/#7). All High→Low. Plus the deferred DB/calibration/concurrency set across waves 3/4/6/7.

## Patterns established (catalogue items 18–19)

18. **A cache key that doesn't encode completeness caches incompleteness.** Commit-pinned keys assume "same commit ⇒ same result", but ingestion is non-deterministic under upstream flakiness — gate caching on a quality signal (coverage), not just identity.
19. **Trust the boundary's own answer, not the request you made.** A peeked/cached response must be re-verified to be *for what you asked* before you render it; an id collision otherwise shows the wrong tenant's data.
