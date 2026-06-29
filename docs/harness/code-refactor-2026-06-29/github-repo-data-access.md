# Code Refactor — GitHub Repo Data Access
> Total: 5 | Critical: 0 High: 1 Medium: 2 Low: 2

## 1. Four divergent per-module "GET JSON from GitHub" helpers; two bypass the shared `fetchWithTimeout`
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/github/source.ts:223-252 (`ghJson`); src/lib/github/governance.ts:14-22 (`getJson`); src/lib/github/discover.ts:60-67 (`ghUser`); src/lib/github/list.ts:99-115 (inline `fetch` in `listOrgRepos`)
- **Scenario**: Each module hand-rolls its own "build headers → fetch → check `res.ok` → `res.json()`" function. `host.ts` already centralizes the two halves of "consistent auth" (`ghHeaders` for headers, `fetchWithTimeout` for the abort/timeout/signal merge), and `source.ts`/`governance.ts`/`graphql.ts` route through `fetchWithTimeout`. But `discover.ts.ghUser` and the `list.ts` pagination loop call **raw `fetch()`** — so they share neither the timeout protection nor the single fetch path.
- **Root cause**: The shared layer stopped at `ghHeaders` + `fetchWithTimeout`; no shared `ghGetJson<T>()` exists, so every consumer re-implemented the same small scaffold and two of them drifted off the timeout helper entirely.
- **Impact**: The module group whose documented purpose is "consistent auth and error handling" has four subtly different request helpers. A change to header policy, retry, or timeout behavior must be made in four places and is easy to miss in the two raw-`fetch` callers (as already happened — they have no timeout). New code copies whichever helper it lands next to.
- **Fix sketch**: Add one `ghGetJson<T>(url, { token, signal, timeoutMs, userAgent })` (or a `ghFetch` returning the `Response`) in `host.ts` that wraps `fetchWithTimeout(url, { headers: ghHeaders(...), cache: "no-store" }, ms, signal)`. Re-express `ghUser` and the `list.ts` loop on top of it (gaining the timeout for free), and have `ghJson`/`getJson` layer only their distinct error-shaping on top of the shared core.

## 2. GitHub REST status→typed-error mapping (rate-limit/403/429 sniff) duplicated across two modules
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/github/source.ts:234-250 (`ghJson`); src/lib/github/list.ts:100-113 (`listOrgRepos`)
- **Scenario**: Both files independently translate a GitHub HTTP status into a typed error, including the identical rate-limit heuristic `status === 429 || res.headers.get("x-ratelimit-remaining") === "0"` and the 403/401/404 branching. They throw into two parallel taxonomies — `GitHubError` (codes `INVALID_URL|NOT_FOUND|RATE_LIMITED|UPSTREAM|EMPTY`, src/lib/github/source.ts:49-63) and `GitHubListError` (codes `NOT_FOUND|RATE_LIMITED|AUTH|UPSTREAM`, src/lib/github/list.ts:45-54).
- **Root cause**: Two scan paths (snapshot vs org listing) each grew their own status mapping rather than sharing one classifier.
- **Impact**: The mapping has already diverged — `list.ts` distinguishes an `AUTH`/401 case `source.ts` collapses into `UPSTREAM`; `source.ts` reads `retry-after` is absent while `list.ts` parses it. A future GitHub status convention change (or a fix to the rate-limit sniff) must be applied twice and kept in sync by hand.
- **Impact (bundle)**: Two near-identical error classes ship where one base could serve both.
- **Fix sketch**: Extract a shared `classifyGithubStatus(res): { code; retryAfterSec? }` helper (in `host.ts`) returning a discriminated result; let each module map that result into its own error class, or unify on one `GitHubError` carrying the superset of codes and let callers branch on `.code`.

## 3. The `split("/").map(encodeURIComponent).join("/")` path/ref encoder is copy-pasted 5×, including a duplicate of the existing `encodeRef` helper
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/github/source.ts:124-126 (`encodeRef`), :469 (`fetchContents`), :489-492 (`fetchRaw`); src/lib/github/write.ts:55, :102
- **Scenario**: The exact expression `<s>.split("/").map(encodeURIComponent).join("/")` appears five times across two files. `source.ts` even names it once as `encodeRef` — with a long doc comment explaining *why* per-segment encoding is correct (preserving slashes in `release/1.2` refs) — yet `fetchContents` and `fetchRaw` re-inline the same logic instead of calling it, and `write.ts` inlines it twice more for content-API paths.
- **Root cause**: `encodeRef` is module-private and was only wired into the tree/commit URLs; the file-path call sites and `write.ts` re-implemented the identical operation rather than reusing it.
- **Impact**: The correctness rationale documented on `encodeRef` is silently re-implemented in four un-commented copies that can drift from it; any fix to the encoding (e.g. handling a new edge case) has to be found and applied in five spots. `write.ts` reaching into the same logic with no shared helper is the cross-file smell.
- **Fix sketch**: Export a single `encodePathSegments(s: string)` (rename/generalize `encodeRef`, since it's used for both refs and file paths) from `host.ts`, and replace all five occurrences in `source.ts` and `write.ts` with the call.

## 4. `GhRepo` interface declared three times with three different shapes (one re-declares `GhRepoRow` instead of extending it)
- **Severity**: Low
- **Category**: naming
- **File**: src/lib/github/list.ts:18-22; src/lib/github/discover.ts:55-58; src/lib/github/app.ts:198-209 (and the overlapping `GhRepoResponse` at src/lib/github/source.ts:254-269)
- **Scenario**: Three modules each define a local interface literally named `GhRepo`, each a different projection of a GitHub `/repos` row. `list.ts` and `discover.ts` correctly `extends GhRepoRow` (the shared base in `host.ts`), but `app.ts`'s `GhRepo` re-declares all seven `GhRepoRow` fields (`name`, `full_name`, `owner.login`, `html_url`, `fork`, `archived`, `private`) standalone — exactly the drift `GhRepoRow` was introduced to prevent. `source.ts` models the same payload again as `GhRepoResponse`.
- **Root cause**: The shared `GhRepoRow` base was added after `app.ts`'s interface, and the name `GhRepo` was reused per-module without distinguishing the projections.
- **Impact**: The repeated name makes it ambiguous which `GhRepo` is in play when reading across files, and `app.ts`'s standalone copy can silently diverge from the canonical `GhRepoRow` field set (e.g. an `isListableRepo` field change wouldn't reach it).
- **Fix sketch**: Make `app.ts`'s `GhRepo extends GhRepoRow` and drop the duplicated base fields; consider renaming each projection to its intent (`GhListRepoRow`, `GhDiscoverRepoRow`, `GhInstallationRepoRow`) so the name signals the shape.

## 5. Stale "BUG (...)" archaeology comment in `discover.ts` describing an already-fixed defect
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/github/discover.ts:18-21
- **Scenario**: A four-line top-of-module comment reads "BUG (github-repo-data-access #1): this module was the only github layer hardcoding api.github.com, so org auto-discovery ignored the GHES `GITHUB_API_URL` override and broke …" — written in the past tense about a defect that is already fixed (`ghUser` now resolves `githubApiBase()` per call, src/lib/github/discover.ts:61, and a regression test pins it, src/lib/github/discover.test.ts:152-187). The same `BUG (<context> #n)` historical-tracker style also lingers at src/lib/github/app.ts:223.
- **Root cause**: Fix-time commentary referencing an internal finding-tracker id was left in the source instead of the commit/PR history once the fix landed.
- **Impact**: Reads as a live warning to anyone scanning the file, and ties source to an out-of-band finding numbering scheme that means nothing in the codebase. Minor confusion/noise.
- **Fix sketch**: Delete the `BUG (...)` paragraph (the behavior is now the documented norm and test-pinned); if any rationale is worth keeping, fold a one-line "resolved per-call so a late `GITHUB_API_URL` is honored" note into the `ghUser` doc and drop the tracker id.
