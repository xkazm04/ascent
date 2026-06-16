# GitHub Repo Data Access — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 3, Medium: 2, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 6 (+3 callers for verification)

## 1. Org listing silently under-returns when forks/archived dominate, and never paginates
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: pagination cutoff / partial data
- **File**: src/lib/github/list.ts:45-66
- **Scenario**: A caller asks for `count` repos (onboarding selector allows up to 50; bulk import up to 100). `perPage = Math.min(100, count*2)`, so for `count >= 50` only ONE page of 100 is ever fetched. `.filter(r => !r.fork && !r.archived).slice(0, count)` then runs against that single page. An org whose 100 most-recently-pushed repos are mostly forks or archived (a heavy fork-based or mirror org) yields far fewer than `count` results — sometimes zero — and the function returns that short list as if it were complete.
- **Root cause**: Filtering happens AFTER a fixed-size single fetch, and there is no Link-header (`rel="next"`) follow-through to backfill the slots lost to filtering. The 2× over-fetch is an unprincipled guess that collapses entirely once `count >= 50`.
- **Impact**: `/api/org/repos` shows a truncated/empty repo picker; `/api/org/import` (line 148) imports fewer repos than requested with no signal, and can hit `fullNames.length === 0 → "No public repositories found"` (route.ts:152) for an org that demonstrably has public non-fork repos. Silent data loss on a primary onboarding surface.
- **Fix sketch**: Loop on the `Link` header following `rel="next"` until `count` post-filter results are collected or pages are exhausted (cap pages, e.g. 5). Keep filtering inside the loop so filtered-out repos are backfilled rather than lost.

## 2. Non-404 errors on the org path abort the user fallback and mask rate limits as "not found"
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: error handling / rate-limit misclassification
- **File**: src/lib/github/list.ts:48-67
- **Scenario**: The function tries `/orgs/{org}/repos`, then falls back to `/users/{org}/repos` ONLY on a 404. If the first call returns 403 (primary or secondary rate limit) or 401 (bad/expired `GITHUB_TOKEN`), `if (!res.ok) throw` fires immediately — the `/users/` fallback never runs, so a perfectly valid *user* handle fails whenever the org probe is rate-limited. Worse, `/api/org/repos/route.ts:23-27` maps every thrown error to HTTP **404** with the raw message, so a rate-limit or auth failure is reported to the client as "repository not found."
- **Root cause**: The fallback condition only special-cases 404; all other statuses (incl. 403/429/401) are treated as fatal and undistinguished, and the route's catch hardcodes a 404 status.
- **Impact**: Users on a busy shared `GITHUB_TOKEN` see "no such org/user" for real accounts; operators can't tell a rate-limit/auth outage apart from a typo. No retry-after surfaced (no `Retry-After`/`x-ratelimit` handling exists anywhere in this layer).
- **Fix sketch**: On 403/429 from the org probe, inspect `x-ratelimit-remaining`/`Retry-After` and surface a typed RATE_LIMITED error (HTTP 429) rather than throwing through to a 404; only treat 404 as "try user". Optionally still attempt `/users/` on non-rate-limit non-404 before giving up.

## 3. Governance and commit-activity vanish silently on 403/429 rate limits
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / swallowed error
- **File**: src/lib/github/governance.ts:53-88, 99-137
- **Scenario**: `fetchBranchGovernance` computes `readable = branchRes.status === 200 || rulesRes.status === 200`. When BOTH calls return 403 (secondary rate limit / abuse detection, common during bulk org import which fans out two governance calls per repo), `readable` is false → returns `null`. `fetchCommitActivity` likewise returns `null` on any non-200/non-202. Downstream `applyGovernanceSignals` (pulls.ts:240) does `if (!gov || !gov.readable) return signals` — so a rate-limited repo scores *identically to one with no branch protection at all*, with no distinction between "no guardrails" and "we couldn't read the guardrails."
- **Root cause**: A 403/429/5xx is collapsed into the same `null` as a legitimately-unprotected branch; the `catch {}` blocks (governance.ts:85, 134) further swallow transport errors into `null`. No backoff/retry on 403 (only 202 is retried).
- **Impact**: During large imports the busiest, most-governed repos are the most likely to be rate-limited here, and they get *under-credited* on D3/D6/D8 — the maturity score systematically penalizes exactly the repos that have the most CI/branch governance. No telemetry distinguishes the cause.
- **Fix sketch**: Distinguish 403-with-`x-ratelimit-remaining:0` / 429 from a clean read: return a sentinel (or set `readable:false` with a `rateLimited` flag) so callers can skip the dimension entirely instead of treating it as "absent," and log/retry with backoff as the 202 path already does.

## 4. PR pagination can short-circuit on a partial GraphQL page, dropping requested PRs
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: pagination / partial-data interaction
- **File**: src/lib/github/graphql.ts:62-75, 124-138
- **Scenario**: `githubGraphql` intentionally returns partial `data` when GitHub sends `data + errors` (a node that failed to resolve is dropped). In `fetchPullRequests`, a page can therefore come back with `pr.nodes.length` LESS than the `num` requested, while `hasNextPage` is true. The loop pushes the short node set and advances by `target - nodes.length`, but the per-page `num` and `MAX_PAGES=10` bound mean a repo that hits node errors on several pages can exhaust the 10-page cap before reaching `target`, returning fewer PRs than asked — and `summarizePullRequests` then computes rates over a smaller, non-representative sample with no truncation signal. Separately, `if (pr.nodes.length === 0) break` (line 136) treats an all-errored page (zero resolved nodes but `hasNextPage:true`) as the end of the repo.
- **Root cause**: The page loop assumes each page yields exactly `num` nodes; the partial-data tolerance in `githubGraphql` (good for resilience) breaks that assumption, and zero-node pages are misread as "short last page."
- **Impact**: PR-derived signals (reviewedRate, aiGovernedRate gated at ≥5 samples in pulls.ts:147) can be computed off a quietly-undersized window, or skipped, on repos with flaky GraphQL nodes — score drift with no surfaced caveat.
- **Fix sketch**: Drive the loop off `hasNextPage`/`endCursor` (not node count) and only stop on `!hasNextPage`; track and surface a `truncatedByErrors` flag when partial pages were encountered so the analyzer can widen the sample floor or annotate the report.

## 5. Untrusted `repos[]` owner/name reach raw GitHub URLs unvalidated in org import
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation gap at trust boundary
- **File**: src/app/api/org/import/route.ts:141-150 (consumes src/lib/github/source.ts ingestion)
- **Scenario**: `list.ts` carefully validates `org` against `VALID_HANDLE` before interpolation (list.ts:33-38), but the `body.repos[]` import path bypasses that entirely: each entry is split on `/` into `owner`/`name` with empty-string defaults and fed straight into `scanRepository` → `source.ts` (`/repos/${owner}/${repo}/...`, `${RAW}/${owner}/${repo}/...`). A crafted entry like `"../../enterprises/x"` or one containing path/host-control characters is only partially neutralized: `fetchRaw`/`fetchContents` encode the *path/branch* segments, but the `owner`/`repo` segments in `source.ts` (lines 349, 363, 366, 478, 497) and `governance.ts`/`graphql.ts` are interpolated raw with no charset check.
- **Root cause**: `parseRepoUrl`'s charset guard (source.ts:104-106) is only applied on the URL-entry path; the import route constructs `{owner, name}` directly and `fetchSnapshot` trusts its `ParsedRepo` without re-validating.
- **Impact**: Request-path manipulation / SSRF-shaped surface on an anonymous-capable funnel (`mock` import is open). Even short of host rewrite, malformed coordinates produce confusing 404s and wasted quota. Defense-in-depth gap: the only validation is on a sibling code path.
- **Fix sketch**: Validate every `{owner, name}` (incl. those derived from `body.repos[]`) against the same `VALID_HANDLE`/name charset before any fetch — ideally enforce it inside `fetchSnapshot`/the shared GitHub helpers so no caller can bypass it.
