> Total: 6 findings (0 critical, 1 high, 3 medium, 2 low)

# GitHub Repo Data Access — combined bug+ui scan

## 1. Org auto-discovery hardcodes api.github.com, ignoring the GHES host override
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: configuration / silent failure
- **File**: src/lib/github/discover.ts:16
- **Scenario**: A GitHub Enterprise Server (GHES) deployment sets `GITHUB_API_URL=https://ghe.acme.com/api/v3` (the whole point of `src/lib/github/host.ts`). After a user signs in via OAuth, the callback calls `fetchUserOrgs` / `fetchUserRepos` to pre-seed the dashboard. Those requests hit the hardcoded `https://api.github.com` instead of the enterprise host — which is either firewalled/unreachable behind the air gap, or (on a mixed deployment) authenticates the GHES token against the wrong host and 401s.
- **Root cause**: `const API = "https://api.github.com";` is a literal here, whereas every other module in this layer (`source.ts`, `list.ts`, `governance.ts`, `graphql.ts`, `app.ts`) routes through `githubApiBase()`/`githubGraphqlUrl()`/`githubRawBase()`. `discover.ts` was missed when host resolution was centralized.
- **Impact**: On GHES, org auto-discovery silently fails (caught best-effort by the callback) → brand-new enterprise users land on an empty org view with no suggested orgs and no watchlist seed, defeating the discovery feature precisely where it is configured. No error surfaces.
- **Fix sketch**: `import { githubApiBase } from "@/lib/github/host"` and replace `const API = "https://api.github.com"` with `const API = githubApiBase();` (matching the other modules). Add a host.ts-driven case to `discover` coverage.

## 2. estimateCoverage applies the fetch-success-rate guard only to small repos
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent failure / stale-cache
- **File**: src/lib/github/source.ts:650
- **Scenario**: A large repo (`totalBlobs > MAX_FILES`, 32) is scanned during a transient raw-host blip that drops half the picked files. Coverage is computed as `Math.min(0.9, 0.4 + fetched / totalBlobs)` — which ignores how many of the attempted picks actually succeeded. The scan routes use coverage as the cache-pin guard, so the degraded snapshot gets cached for the full TTL and every subsequent viewer is served the blip-degraded report.
- **Root cause**: The `fetchRate = fetched / attempted` correction (added expressly so "a blip-degraded scan drops below the cache threshold so it isn't pinned") is multiplied in ONLY on the small-repo branch (`0.95 * fetchRate`). The large-repo branch never references `fetchRate`, so the exact failure mode the fix targets is still live for any repo over 32 blobs.
- **Impact**: Large repos with a partial-fetch blip are cached as adequately-covered and serve a degraded score until the TTL expires — the same data-quality regression the guard was written to prevent, just for the bigger half of repos.
- **Fix sketch**: Apply the success-rate factor to both branches, e.g. `const base = totalBlobs <= MAX_FILES ? 0.95 : Math.min(0.9, 0.4 + fetched / totalBlobs); let c = base * fetchRate;` (or otherwise fold `fetchRate` into the large-repo path).

## 3. PR pagination re-fetches page 0 when GraphQL reports hasNextPage with a null endCursor
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge case / data corruption
- **File**: src/lib/github/graphql.ts:138
- **Scenario**: `githubGraphql` deliberately returns partial data when GitHub responds with both `data` and `errors` (a node failed to resolve). If such a partial page carries `pageInfo.hasNextPage === true` but `endCursor === null` (a documented GraphQL possibility under partial errors / connection issues), the loop does not break (line 138 only breaks on `!hasNextPage` or zero nodes), sets `after = pr.pageInfo.endCursor` (= `null`), and the next iteration re-requests the FIRST page with `after: null`.
- **Root cause**: The loop advances on `hasNextPage` but trusts `endCursor` to be non-null whenever `hasNextPage` is true; it never guards against `hasNextPage && !endCursor`.
- **Impact**: Duplicate PR nodes are appended (the same newest PRs counted up to MAX_PAGES=10 times), inflating/skewing the PR-derived D6/D8 governance rates that feed the score. Bounded by MAX_PAGES so not infinite, but the score is computed off a duplicated, non-representative sample.
- **Fix sketch**: Break when the cursor can't advance: `if (!pr.pageInfo?.hasNextPage || !pr.pageInfo.endCursor || pr.nodes.length === 0) break;` before assigning `after`.

## 4. Rate-limited governance/activity fetches are indistinguishable from "no protection"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent failure
- **File**: src/lib/github/governance.ts:71
- **Scenario**: During a fleet scan the token's REST budget is exhausted (or GitHub returns 403/429) on `/branches/{branch}` and `/rules/branches/{branch}`. `getJson` returns those non-200 statuses, `readable` is false, and `fetchBranchGovernance` returns `null`. `fetchCommitActivity` likewise returns `null` on any non-200. Unlike `source.ts`/`list.ts`, neither distinguishes a rate-limit/auth failure from a genuine "repo has no rules / no activity".
- **Root cause**: `getJson` collapses every status into `{status, body}` and the callers only treat 200 as success; there is no RATE_LIMITED path. `applyGovernanceSignals` then treats `null` as neutral (no boost), so a transient outage silently produces a lower-than-true score with no warning emitted (contrast `fetchCommitActivity`'s loud `console.warn` on persistent 202).
- **Impact**: A repo that actually has branch protection scores as if it has none (missing D6/D3/D8 boosts) whenever governance is rate-limited mid-fleet-scan, and the result is cached — silently understating mature repos with no signal that the data was incomplete.
- **Fix sketch**: Detect 403-with-`x-ratelimit-remaining: 0` / 429 in `getJson` (as `source.ts` does) and surface it — either throw a typed rate-limit error the scan can record as a detector warning, or return a distinct `{ readable: false, rateLimited: true }` so the score isn't silently degraded and cached.

## 5. Abort listeners accumulate across commit-activity 202 retries
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: resource leak
- **File**: src/lib/github/governance.ts:124
- **Scenario**: On a busy repo, `/stats/commit_activity` returns 202 repeatedly. Each backoff iteration registers a fresh `signal.addEventListener("abort", …, { once: true })`. When the timer (not the abort) resolves the backoff, that listener is never removed, so up to 3 stale listeners stay attached to the request's `AbortSignal` for the remainder of the request.
- **Root cause**: The backoff promise adds an abort listener but only relies on `{ once: true }`; it does not `removeEventListener` after the timer wins, so each non-aborted retry leaks one listener.
- **Impact**: Minor — bounded to a few listeners per scan and freed when the signal is GC'd. On a large fleet scan sharing one long-lived signal it is wasted retained closures, not a correctness bug.
- **Fix sketch**: Capture the handler, `clearTimeout` and `signal?.removeEventListener("abort", handler)` in the resolve path (both timer-win and abort-win), so each retry cleans up its own listener.

## 6. resolveHead accepts a 7-char partial as a full head SHA
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation gap
- **File**: src/lib/github/source.ts:203
- **Scenario**: `resolveHead` validates the `commits/HEAD` (`application/vnd.github.sha`) response body with `/^[0-9a-f]{7,40}$/i`. GitHub always returns a full 40-char SHA for this media type, but a truncated/partial response (a cut connection that still passes `res.ok`, or a proxy that trims the body) yielding a 7–39 hex prefix is accepted as a valid head and returned as `sha`.
- **Root cause**: The length range `{7,40}` is over-permissive for an endpoint whose contract is exactly 40 hex chars; it was likely copied from a "looks like a sha" heuristic.
- **Impact**: A partial SHA becomes the scan cache key (`owner/repo@sha::mode`) and the pinned ref. A later full-SHA resolution for the same commit produces a different key → cache miss / split cache entries, and the pinned-ref tree read uses a short SHA (which the trees API may resolve ambiguously or 404). Rare, requires a malformed-but-ok response.
- **Fix sketch**: Tighten to the exact contract: `/^[0-9a-f]{40}$/i` (full SHA only) for this endpoint; treat anything shorter as `{ status: "error" }`.
