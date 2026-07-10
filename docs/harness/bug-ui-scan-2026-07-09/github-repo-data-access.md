# GitHub Repo Data Access — bug-hunter + ui-perfectionist scan

> Context: GitHub Repo Data Access (group: Identity & GitHub Connectivity)
> Files scanned: 8
> Total: 7 findings (Critical: 0, High: 1, Medium: 5, Low: 1)

## 1. The GraphQL `partial` flag is orphaned — partial PR results are cached as authoritative
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/github/graphql.ts:173
- **Scenario**: A repo returns a GraphQL `pullRequests` page with `data` AND `errors` (one PR node fails to resolve — common on large/complex queries). `githubGraphql` correctly flags `partial:true`, and `fetchPullRequests` returns `{ totalCount, nodes, partial:true }`. The sole production consumer, `fetchPrStats` (src/lib/analyze/pulls.ts:291), destructures only `{ totalCount, nodes }` and returns a plain `PrStats` — dropping `partial`. A repo-wide grep confirms no code path reads `PullRequestsResult.partial`.
- **Root cause**: The elaborate partial-tolerance design assumes a downstream consumer will honor the documented contract (graphql.ts:40-47: "annotate 'based on partial data' and skip caching a partial result"). Nothing does; the flag dies at the first hop.
- **Impact**: An under-stated review/collaboration score computed from an incomplete PR slice is cached in-memory AND persisted cross-instance, then served as an authoritative maturity verdict. The exact failure the code says it prevents.
- **Fix sketch**: Thread `partial` through `PrStats` (or return it from `fetchPrStats`), OR at minimum feed it into `classifyScanResult`/`cacheAndPersistScan` so a partial PR ingest sets `lowCoverage`/skips caching and adds a report caveat.

## 2. A swallowed commits-list failure corrupts head identity (tree sha vs commit sha)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/lib/github/source.ts:397
- **Scenario**: `commitsReq(...).catch(() => [])` (line 371) swallows every failure — rate-limit, timeout, 5xx. When only the `/commits` list call blips (meta + tree still succeed), `commitsRes` is `[]`, so `repoMeta.headSha = commitsRes[0]?.sha ?? treeRes.sha` falls back to the **tree object sha**. The code's own comment (391-396) warns the tree sha is wrong for the cache key, `/report@sha` permalinks, and the `@@unique([repoId, headSha])` dedup.
- **Root cause**: The `.catch(()=>[])` conflates "repo genuinely has no commits" with "the commits fetch failed", and the tree-sha fallback is only valid for the former.
- **Impact**: The scan persists under a tree sha ≠ the commit sha that `resolveHead` (which uses `commits/HEAD`) keyed the cache with → permalink 404s, defeated dedup, and a duplicate row on the next scan of the same commit.
- **Fix sketch**: Distinguish an empty-but-successful list from a thrown fetch; on a commits-fetch error, either propagate or re-resolve the head sha via `resolveHead` rather than silently using `treeRes.sha`.

## 3. `estimateCoverage` marks essentially every 500+ file repo as "low coverage"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/github/source.ts:667
- **Scenario**: For a large repo the formula is `Math.min(0.9, 0.4 + fetched/totalBlobs)` with `fetched` capped at ~50 (MAX_FILES). For any repo with `totalBlobs > 500`, `fetched/totalBlobs < 0.1`, so coverage `< 0.5` — which trips scan.ts:504 to append "Only part of the repository could be inspected (~N% coverage); treat scores as indicative."
- **Root cause**: The additive floor (0.4) plus a term that is structurally tiny for any real-world app means the 0.5 caveat threshold is crossed by file count alone, not by any actual ingestion shortfall.
- **Impact**: The "indicative / low coverage" caveat becomes cry-wolf noise on the majority of non-trivial repos, and (given the same 0.5 threshold gates confidence-driven caching) can suppress caching for healthy scans.
- **Fix sketch**: Base large-repo coverage on the fraction of *signal-bearing* files fetched (fetched/attempted) rather than fetched/totalBlobs, or raise the floor so a fully-successful ingest of a big repo doesn't read as degraded.

## 4. `MAX_FILES` cap can starve last-ranked workflow ingestion, re-blinding the D9 security checks
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/github/source.ts:648
- **Scenario**: `pickFilesToFetch` adds workflows LAST (step 7) so they rank lowest for the prompt window, but `add()` refuses any file once `picked.size >= MAX_FILES` (50). On a manifest-heavy polyglot monorepo (many of the ~34 exact-name manifests present + docs + tests + 6 source samples), the 50-slot budget can fill before step 7, so few or zero workflows are fetched.
- **Root cause**: The fix that raised MAX_WORKFLOW_FILES to 24 assumed "added last" only affects prompt ordering, but "last" also means "first starved" under the shared MAX_FILES cap.
- **Impact**: The deterministic D9 security battery reads the `files` array; with workflows absent it goes blind on token-perms/pinned-actions/SAST detection — the exact regression the comment at lines 37-41 claims to have closed — understating the security score on big repos.
- **Fix sketch**: Reserve a dedicated workflow quota outside/on-top of MAX_FILES, or add workflows before the source/test samples so security-relevant content isn't evicted by texture files.

## 5. A 200 with an unparseable body reports a branch as `protected:false`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/lib/github/governance.ts:51
- **Scenario**: `getJson` sets `body = await res.json().catch(() => null)`. `fetchBranchGovernance` guards only on status (`if (branchRes.status !== 200) return null`). A 200 whose body fails to parse (truncated stream, a proxy returning HTML-with-200) yields `body === null`, so `isProtected = Boolean((null)?.protected) = false` and it returns `{ protected:false, readable:true }`.
- **Root cause**: The guard validates the HTTP status but not that the protection-bearing body actually parsed into an object — so missing data becomes a confident negative, the precise false-negative the comment (44-48) says to avoid.
- **Impact**: A repo that genuinely enforces branch protection is reported as wide open, understating its governance/maturity score.
- **Fix sketch**: Treat a 200 with a null/non-object `branchRes.body` the same as a failed read — return `null` (protection unknown) instead of deriving `protected:false`.

## 6. Null entries in a partial GraphQL page are pushed unfiltered and later dereferenced
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: partial-response
- **File**: src/lib/github/graphql.ts:166
- **Scenario**: GitHub's `pullRequests.nodes` is `[PullRequest]` with nullable elements; when a node fails to resolve, that entry is `null` (with a matching `errors[]` entry, i.e. the `partial` path). `nodes.push(...pr.nodes)` pushes the `null` through unfiltered. `summarizePullRequests` (src/lib/analyze/pulls.ts:67) does `for (const pr of nodes) { pr.state … }` → TypeError on the null.
- **Root cause**: The partial-tolerance tests cover malformed *fields* (null author, bad dates) but not a fully-null *node*; the fetcher passes nodes through "unvalidated" while the consumer assumes every element is a non-null object.
- **Impact**: `fetchPrStats` throws; scan.ts's `.catch(()=>null)` then drops the ENTIRE PR dimension — so a single unresolved node discards all PR signals, the opposite of the "prefer partial data" intent.
- **Fix sketch**: Filter nulls at the source: `nodes.push(...pr.nodes.filter(Boolean))` (and type `nodes` as `(PrNode|null)[]` from the connection).

## 7. CODEOWNERS reserves only the flat 14 KB byte-claim despite its 60 KB cap
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/github/source.ts:432
- **Scenario**: The concurrency pool optimistically reserves `MAX_FILE_BYTES` (14 KB) before each fetch (line 432), but a CODEOWNERS file is later kept up to `MAX_CODEOWNERS_BYTES` (60 KB, line 453). While a large CODEOWNERS is in flight, the other 7 concurrent workers see a `totalBytes` that under-counts it by up to 46 KB.
- **Root cause**: The reservation uses the default per-file cap, not the per-file cap that actually applies to CODEOWNERS, so the race-free reservation the pool was designed to guarantee is undercut for exactly the oversized file.
- **Impact**: `MAX_TOTAL_BYTES` can overshoot by tens of KB, marginally evicting a later low-priority file. Minor — CODEOWNERS is a single early-ranked file.
- **Fix sketch**: Reserve the applicable cap up front (`CODEOWNERS_PATH_RE.test(path) ? MAX_CODEOWNERS_BYTES : MAX_FILE_BYTES`) before the fetch, then reconcile to actual as today.
