# GitHub Repo Data Access — Bug + UI Scan
> Context: GitHub Repo Data Access (Identity & GitHub Connectivity)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Org-discovery & repo-listing fetches have no timeout/abort — a slow GitHub hangs the login callback
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: recovery-gap / latent-failure
- **File**: src/lib/github/discover.ts:60-67 (`ghUser`, used by `fetchUserOrgs`/`fetchUserRepos`); src/lib/github/list.ts:99 (`listOrgRepos`)
- **Value**: impact 7 · effort 2 · risk 2
- **Scenario**: Right after OAuth, the callback calls `fetchUserOrgs`/`fetchUserRepos` to auto-discover orgs. If GitHub accepts the TCP connection but stalls (a common partial-outage/throttle mode), these bare `fetch()` calls never resolve and never reject. The module's own header comment promises "login is never blocked" because the caller treats discovery as best-effort — but a try/catch only catches *throws*, not a hang. The login callback blocks until the serverless function is force-killed (504), failing sign-in instead of degrading. Same pattern hangs `/api/org/repos` and `/api/org/import` via `listOrgRepos`.
- **Root cause**: Every other call in this layer (`source.ts`, `governance.ts`, `graphql.ts`) routes through `fetchWithTimeout(url, init, ms, signal)` from `host.ts`, but `discover.ts` and `list.ts` call raw `fetch()` with no `AbortController` and no caller `signal` threaded in.
- **Impact**: Sign-in / org-import stalls (eventually 504) on any slow-GitHub condition; the "best-effort, never blocks login" contract is silently false.
- **Fix sketch**: Replace the bare `fetch` in `ghUser` and `listOrgRepos` with `fetchWithTimeout(...)` (the helper already exists and is used module-wide), and thread an optional `signal` through both so client disconnects abort them too — making "discovery can hang the request" impossible.

## 2. Secondary (abuse) rate limits are misclassified as auth/upstream errors
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / error-classification
- **File**: src/lib/github/source.ts:237-246 (`ghJson`); src/lib/github/list.ts:103-110 (`listOrgRepos`)
- **Value**: impact 6 · effort 3 · risk 2
- **Scenario**: During an org/fleet scan the app fires many requests and trips GitHub's *secondary* rate limit, which returns `403` (sometimes `429`) with a `Retry-After` header but leaves `x-ratelimit-remaining` > 0. Both classifiers only treat a 403 as rate-limited when `x-ratelimit-remaining === "0"`, so `source.ts` throws `UPSTREAM "GitHub returned 403."` and `list.ts` throws `AUTH "GitHub denied listing"`. The user is told it's an auth/permissions problem and given no "add a token / back off" guidance, even though the correct remedy is to wait `Retry-After` seconds.
- **Root cause**: Rate-limit detection keys solely on the primary-limit signal (`x-ratelimit-remaining: 0`) and ignores the secondary-limit signals (`Retry-After` present, or body message "secondary rate limit").
- **Impact**: Misleading errors and no backoff exactly when an org-scale scanner most needs them; wrong HTTP status surfaced to callers.
- **Fix sketch**: In both branches, also classify as rate-limited when a `Retry-After` header is present (or the body mentions "secondary rate limit"), and surface `Retry-After` so callers can back off.

## 3. GraphQL PR fetch conflates "no access" with "zero PRs"
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/github/graphql.ts:129-130 (`if (!pr) break;`)
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: When the token can't see a repo's PRs (e.g. a private repo the installation token lacks scope for, or a node-level GraphQL error that nulls `repository`), `data.repository?.pullRequests` is `undefined`, so the loop breaks and returns `{ totalCount: 0, nodes: [] }`. The scoring engine then treats this as a repo with genuinely zero pull requests and scores the collaboration/review dimension (D7) as if the team never opens PRs — understating a mature repo because of an access/transport problem.
- **Root cause**: A missing `repository`/`pullRequests` (access or error) is mapped to the same empty result as a real empty repo; there's no "unknown / not readable" signal distinct from "empty".
- **Impact**: Wrong maturity score (silent false-negative on review practice) with no indication anything failed.
- **Fix sketch**: Distinguish the cases — when `data.repository` is null on the *first* page (vs. a legitimately empty `nodes` with `totalCount: 0`), throw or return an explicit `{ readable: false }` so the scorer omits D7 rather than scoring it as zero.

## 4. `fetchBranchGovernance` reports a branch as fully unprotected when the branch read is denied
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / edge-case
- **File**: src/lib/github/governance.ts:43-67
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: `getJson` does not throw on non-2xx — it returns `{status, body}`. If the `/branches/{branch}` call returns 403/404 (token lacks the needed permission, or the default branch was just renamed) while `/rules/branches/{branch}` returns `200 []`, then `readable` is `true`, `isProtected` is `false`, and every rule flag defaults false. The function returns a confident "this branch has no protection, no required PR, 0 approvals" instead of `null`/unknown — feeding a wrong governance dimension into the maturity score.
- **Root cause**: `readable = branchRes.status === 200 || rulesRes.status === 200` accepts a partial read, then derives concrete "false" posture from the half that failed rather than marking those fields unknown.
- **Impact**: False-negative governance posture → understated maturity score for repos that actually enforce protection, only when the token's branch read is restricted.
- **Fix sketch**: Treat `branchRes` non-200 as "protection unknown" (don't emit `protected:false`); require the branch read specifically before reporting the `protected` flag, or return `null` when the protection-bearing call failed.

## 5. `fetchUserRepos` / `fetchUserOrgs` fetch only one page — incomplete org auto-discovery for active users
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/github/discover.ts:70-97
- **Value**: impact 3 · effort 4 · risk 2
- **Scenario**: A heavy user with 100+ recently-pushed repos (or 100+ org memberships) only gets the first page (`per_page=100`, no `Link`/`rel="next"` follow, unlike `list.ts`). Orgs discovered *only* via repo ownership (the `reposBySlug` path in `rankDiscoveredOrgs`, used when `/user/orgs` doesn't list them) can be dropped entirely if their repos fall past the first 100, so the suggested-org list and the watchlist seed miss the user's actual most-active org.
- **Root cause**: The two discovery fetchers were written as a single page; `list.ts` already has `nextPageUrl`/`MAX_LIST_PAGES` pagination but it isn't reused here.
- **Impact**: New users with large footprints land on a less-populated/incorrectly-ranked dashboard; degraded onboarding, not data loss.
- **Fix sketch**: Reuse `list.ts`'s `Link`-header pagination (bounded by a small `MAX_PAGES`) in `ghUser`, or accept the limitation explicitly and rely on `/user/orgs` for membership-only discovery.
