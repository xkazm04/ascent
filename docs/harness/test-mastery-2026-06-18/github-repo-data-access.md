> Total: 5 findings (2 critical, 2 high, 1 medium)
# Test Mastery — GitHub Repo Data Access

This context is the typed GitHub I/O layer every scan, fleet import, and PR-artifact path consults. Today only `discover.ts`, `codeowners.ts`, and `list.ts` have sibling tests — and those cover only the *pure* transforms. The three highest-blast-radius modules are **completely untested**: `source.ts` (snapshot ingestion, `parseRepoUrl` URL-injection guard, `resolveHead` cache-key SHA, `estimateCoverage` cache-poison gate), `governance.ts` (branch-protection posture), and `graphql.ts` (PR ingestion). The findings below are ranked by business blast radius, not line count.

## 1. Pin `parseRepoUrl` against the SSRF / path-injection vectors it exists to block
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/github/source.ts:69 (`parseRepoUrl`)
- **Scenario**: A refactor of the URL/scheme branching (e.g. the `hadScheme` guard at :84-90, the leading-dot bare-parse heuristic at :98, or the charset gate at :105-106) lets a crafted input like `https://evil.com/a/b`, `gitlab.com/a/b`, `owner/repo/../../admin`, `owner/re po`, or `@evil` slip through as a `{owner, repo}` pair. That value is then interpolated straight into `https://api.github.com/repos/${owner}/${repo}` and `raw.githubusercontent.com/...`. A silent regression here is an SSRF / request-path-rewrite vulnerability that ships green.
- **Root cause**: `parseRepoUrl` is the single sanitizer for repo coordinates reaching **11+ untrusted entry points** (`/api/scan`, `/api/scan/stream`, `/api/history`, `/api/recommendations`, `/api/practices/{generate,apply,apply-batch}`, `/api/report/conformance`, `org/playbooks/[id]/apply`, trends + compare pages). It has **zero** dedicated tests — no `source.test.ts` exists. `list.ts`'s analogous `isValidHandle`/`isValidRepoName` ARE pinned in `list.test.ts`; this function, which guards more callers, is not.
- **Impact**: An SSRF or path-traversal regression in the front-door parser is exploitable across the entire public API surface and would not be caught by any test.
- **Fix sketch**: Add `source.test.ts` with a table-driven suite asserting the invariant *"output is null OR `{owner,repo}` where both match `^[A-Za-z0-9_.-]+$`"*. Positive: `octocat/hello`, `github.com/o/r`, `https://github.com/o/r.git`, `git@github.com:o/r.git`, `release/1.2`-style refs are NOT misparsed as repos. Negative (must return null): `https://evil.com/a/b`, `gitlab.com/a/b`, `owner/repo/../x`, `../../etc`, `o/r%0d`, ` o/r `, `@evil/x`, `https://github.com.evil.com/a/b`, empty string. Assert the non-GitHub-scheme rejection at :88 specifically.

## 2. Test `estimateCoverage` so a transient fetch blip can't poison the scan cache
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/github/source.ts:630 (`estimateCoverage`)
- **Scenario**: The `fetchRate = fetched/attempted` scaling (:638-639) regresses — e.g. someone "simplifies" back to the old `0.95` constant, or the `attempted > 0 ? … : 1` guard flips. A raw-host blip that drops half the picked files then reports a degraded snapshot as ~0.95 coverage, and the scan routes (whose cache-pin guard keys off this number) cache that hole for the full TTL. Every downstream score, badge, and gate verdict is computed off a half-empty snapshot and served as authoritative for hours.
- **Root cause**: The function is pure and trivially testable, but untested. Its own comment documents that this exact regression already happened once ("a small repo used to pin 0.95 regardless of how many picks failed"). A documented past bug with no regression test is a guaranteed re-break.
- **Impact**: Silent data-integrity failure: degraded scans get cached and drive money/gate/badge decisions. This is the cache-poison class the comment was written to prevent.
- **Fix sketch**: In `source.test.ts` assert the invariants: (a) small repo, all picks succeed → `0.95`; (b) small repo, half picks fail (`fetched=4, attempted=8`) → `< 0.95` and below the route's cache threshold; (c) `truncated=true` clamps to `≤ 0.6` regardless of fetch rate; (d) `attempted=0` → does not NaN (returns the `*1` branch); (e) large repo (`totalBlobs > MAX_FILES`) uses the `0.4 + fetched/totalBlobs` branch capped at `0.9`. Export the function (it's module-private today — promote to exported for the test).

## 3. Cover `resolveHead`'s status mapping — the SHA that keys cache freshness and the free-304 promise
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/github/source.ts:185 (`resolveHead`)
- **Scenario**: The status branching regresses: a 304 stops mapping to `unmodified` (so the "free re-validation" promise breaks and a quiet repo burns quota), or the SHA-shape guard at :202 (`/^[0-9a-f]{7,40}$/i`) is loosened so a non-SHA body (an HTML error page, a truncated string) is returned as `{status:"ok", sha}`. That bogus SHA becomes the `owner/repo@sha::mode` cache key — either fragmenting the cache or, worse, colliding scans. The module comment calls this "the core freshness promise of a maturity scorer."
- **Root cause**: `resolveHead` is only ever *mocked* (in `scan-cache.test.ts`) — its real status→`HeadLookup` mapping is never exercised. The consumer contract is tested; the producer is not. The 304-is-free behavior and the SHA-validation gate have no direct assertion anywhere.
- **Impact**: A regression silently defeats cache invalidation (stale reports served after a push) or inflates GitHub quota on every keyless re-scan — directly hitting the freshness guarantee and the rate-limit budget.
- **Fix sketch**: In `source.test.ts` stub `fetch` (as `list.test.ts` does) and assert: 304 → `{status:"unmodified"}` (and that `If-None-Match` was sent when `etag` passed); 200 with a 40-hex body → `{status:"ok", sha:lowercased, etag}`; 200 with a non-SHA body (`"<!DOCTYPE html>"`) → `{status:"error"}`; 404/403/network-throw → `{status:"error"}`. Invariant: a returned `ok.sha` always matches `^[0-9a-f]{7,40}$` and is lowercased.

## 4. Test `fetchBranchGovernance`'s rule extraction and `readable`-vs-null contract
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/github/governance.ts:47 (`fetchBranchGovernance`)
- **Scenario**: The ruleset parsing (:62-82) regresses — `byType("pull_request")` lookup, the `required_approving_review_count` plucking, or the `readable = branchRes.status===200 || rulesRes.status===200` gate (:70). The repo then reports `requiresPullRequest:false` / `requiredApprovals:0` for a branch that IS protected (or returns `null`="unknown" when one of the two calls actually succeeded). Governance posture feeds the maturity score and the org security/governance views — a false "no protection" reading misrepresents an org's compliance posture in an executive briefing.
- **Root cause**: `governance.ts` has no test file at all. The success path, the partial-readability path (one call 200, one 404), and the all-fail→null path are entirely unverified, despite non-trivial branching over an untyped `rules[]` array.
- **Impact**: Wrong governance signal flows into scores, security/governance dashboards, and exec PDFs — a credibility-critical number for the buyer persona, with no test guarding the mapping.
- **Fix sketch**: Add `governance.test.ts`, stub `fetch` to return paired `branches/{branch}` + `rules/branches/{branch}` responses. Assert: full rule set → all flags true and `requiredApprovals` plucked from `parameters`; `pull_request` rule absent → `requiresPullRequest:false, requiredApprovals:0`; both calls non-200 → returns `null` (not a `readable:true` object); one 200 / one 404 → returns an object with `readable:true`. Invariant: `null` is returned **iff** neither call returned 200.

## 5. Add an error-branch test for `fetchPullRequests` partial-data and pagination-stop behavior
- **Severity**: Medium
- **Category**: error-branch
- **File**: src/lib/github/graphql.ts:39 (`githubGraphql`) and :110 (`fetchPullRequests`)
- **Scenario**: The partial-result handling at :63-75 regresses back to throwing on *any* `errors[]` even when `data` is present — failing an entire org/repo scan over one un-resolvable PR node. Or the pagination loop's stop conditions (:136: `!hasNextPage || nodes.length===0`, and the `MAX_PAGES` bound) regress into an infinite/short loop, so a caller asking for 200 PRs silently gets 100 and scores off a non-representative slice with no truncation signal.
- **Root cause**: `graphql.ts` has no test file. The "prefer partial data" contract (the comment's stated intent) and the cursor-walk termination are unverified; only the downstream consumer `pulls.ts` imports the `PrNode` *type*.
- **Impact**: A regression either fails scans over one bad PR node (availability) or silently truncates the PR sample (quietly wrong delivery/review signals). Lower blast radius than money/security, hence Medium.
- **Fix sketch**: Add `graphql.test.ts` stubbing `fetch`. Assert: response with both `data` and `errors[]` → returns the partial `data` (does NOT throw); response with `data:null` + `errors[]` → throws with the joined messages; response with `data:null`, no errors → throws "no data". For `fetchPullRequests`: two-page mock (page1 `hasNextPage:true` + cursor, page2 short) accumulates both pages' nodes and `totalCount` comes from the page; `hasNextPage:false` stops after one page; verify it never exceeds `MAX_PAGES` fetches when `limit` is huge. Invariant: returned `nodes.length ≤ max(1,limit)` and the loop is bounded.
