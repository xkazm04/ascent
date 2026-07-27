# GitHub Repo Data Access — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Rulesets read failure silently reports "no rules" with `readable: true`
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/lib/github/governance.ts:61`
- **Scenario**: `fetchBranchGovernance` fires the branch read and the rulesets read in parallel. The branch read is carefully guarded (a non-200 or unparseable body returns `null` — "protection unknown", per the #4/#5 fixes documented in comments). But when the **rulesets** call fails (403 from a restricted token, 404 on a GHES version without the rules API, 500, or a body that isn't an array), `rules` silently becomes `[]` and the function returns a Governance object with `requiresPullRequest:false`, `requiredApprovals:0`, `requiresStatusChecks:false`, `requiresSignatures:false`, `linearHistory:false`, `ruleCount:0` — and `readable: true`.
- **Root cause**: `Array.isArray(rulesRes.body) ? (rulesRes.body as Rule[]) : []` conflates "the rulesets endpoint answered with zero active rules" with "the rulesets endpoint was denied/broke". The exact failure mode that was fixed for the `protected` flag was left in place for every ruleset-derived signal, and `rulesRes.status` is never inspected.
- **Impact**: A repo that genuinely enforces PR reviews + status checks via rulesets is scored as having **no** governance rules whenever the rules API is denied — a confident false negative on 6 of the 9 Governance fields, understating maturity on exactly the locked-down enterprise repos most likely to restrict the token. `readable: true` tells downstream the read was trustworthy.
- **Fix sketch**: Mirror the branch-read guard: if `rulesRes.status !== 200` (or the body isn't an array), either return `null` (rules unknown → governance omitted) or return the branch-derived fields with a `rulesReadable: false` flag so the scorer treats rule signals as unknown rather than absent. A 200 with a genuinely empty array remains a real "no rules".

## 2. GraphQL layer has no rate-limit/error taxonomy — a rate-limited org scan is indistinguishable from "partial data" or a generic failure
- **Severity**: High
- **Category**: trade-off-undocumented
- **File**: `src/lib/github/graphql.ts:69-86`
- **Scenario**: The REST layers each classify failures (`GitHubError` with `RATE_LIMITED`/`retryAfterSec` in source.ts; `GitHubListError` in list.ts). The GraphQL client throws bare `Error("GitHub GraphQL 403")` on a non-OK status, and — worse — GitHub's GraphQL rate limit often answers **200** with `errors: [{type: "RATE_LIMITED", ...}]`. If `data` is null that surfaces as a generic thrown message; if partial `data` accompanies it, the response is logged as a "partial result" and returned with `partial: true`, i.e. a quota exhaustion is reinterpreted as node-resolution noise.
- **Root cause**: The header-comment promises "consistent auth and error handling" across the layer, but the GraphQL path never inspects `errors[].type` (RATE_LIMITED vs NOT_FOUND vs FORBIDDEN) nor the 403/Retry-After headers, and doesn't use the module's typed error classes.
- **Impact**: During mass org scans (the stated reason GraphQL exists here), hitting the GraphQL point budget produces either an opaque scan failure or a silently thin PR sample flagged merely "partial" — callers can't back off, can't surface "add a token / wait N seconds", and may cache/score off a quota-starved slice. Debugging misattributes it to flaky PR nodes.
- **Fix sketch**: Inspect `errors[].type`: on `RATE_LIMITED` (or HTTP 403/429) throw `GitHubError("RATE_LIMITED", …, status, retryAfterSec)` reusing source.ts's class; keep the partial-data path only for genuine node-level errors (e.g. type `NOT_FOUND`/`FORBIDDEN` on individual nodes). Document the taxonomy in the module header.

## 3. CODEOWNERS location precedence is inverted vs GitHub's, and only the first array hit wins
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/lib/github/codeowners.ts:62-65`
- **Scenario**: When a repo carries CODEOWNERS in more than one honored location, GitHub uses a strict precedence: **`.github/` first, then root, then `docs/`** — the later ones are ignored. `findCodeownersContent` returns the first file in the snapshot's `files` array that matches the path regex. That array is ordered by source.ts fetch rank, whose `exactNames` list (source.ts:642-644) fetches `"codeowners"` (root) **before** `".github/codeowners"` — so a repo with a stale root CODEOWNERS and a maintained `.github/CODEOWNERS` gets its team attribution parsed from the file GitHub itself does not honor.
- **Root cause**: The comment claims the regex "mirrors the exact names source.ts fetches" but neither module encodes GitHub's precedence order; matching is first-hit against an ordering chosen for prompt priority, not correctness.
- **Impact**: RepoTeam persistence and getOrgTeamRollup can attribute repos to teams from a superseded file — exactly the migration case (moving CODEOWNERS into `.github/` while the old root copy lingers) where the two disagree. Wrong primary owner, wrong rollups, no error anywhere.
- **Fix sketch**: In `findCodeownersContent`, resolve in GitHub's order: prefer `.github/codeowners`, then `codeowners`, then `docs/codeowners` (case-insensitive), regardless of array order. One extra test fixture with two locations pins the precedence.

## 4. parseRepoUrl silently strips deep-link intent (PR/branch/file URLs scan the default branch)
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/lib/github/source.ts:106-107`
- **Scenario**: `parseRepoUrl` splits the pathname and takes the first two segments, silently discarding the rest. A user pasting `github.com/owner/repo/pull/123`, `/tree/my-branch`, `/releases`, or `/blob/main/README.md` — the URLs people actually have in their clipboard — gets a successful parse of `owner/repo` and a scan of the **default branch**, with no signal that the PR/branch/file part of their input was ignored. (`FetchOptions.ref` exists precisely for pinned-ref scans, but the parser never feeds it.)
- **Root cause**: The function's doc comment ("Accepts full URLs, `github.com/owner/repo`, or bare `owner/repo`") documents the accepted shapes but not the decision to *discard* trailing segments; the trade-off (lenient parse vs honoring the ref) was never recorded.
- **Impact**: A user who pastes a PR link expecting "score this PR" silently gets a default-branch report — a plausible-looking but wrong answer, the worst failure mode for a scorer whose freshness/identity promises (headSha, permalinks) are otherwise handled with great care.
- **Fix sketch**: Either extend the return type with an optional `ref`/`prNumber` extracted from `/tree/<ref>`, `/commit/<sha>`, `/pull/<n>` segments (callers can then pin `opts.ref`), or reject/flag URLs with extra path segments so the UI can say "scanning owner/repo default branch — did you mean PR #123?". Document whichever choice in the JSDoc.

## 5. listOrgRepos MAX_LIST_PAGES truncation returns a short list with no partial indicator
- **Severity**: Low
- **Category**: magic-number
- **File**: `src/lib/github/list.ts:69,132`
- **Scenario**: `MAX_LIST_PAGES = 5` caps the fork/archived backfill at 500 raw repos. For a fork-heavy or archive-heavy org with more than 500 public repos (large OSS orgs easily qualify), the loop exhausts its page budget and `return collected.slice(0, count)` hands back fewer than `count` repos — the exact "reported that short list as complete" failure the in-loop comment says the pagination rewrite fixed, just moved from 1 page to 5.
- **Root cause**: The page bound is a bare constant with a one-line comment ("before giving up") and the return shape carries no way to say "budget exhausted, more may exist"; callers (`/api/org/repos`, `/api/org/import`) cannot distinguish "org has only 37 listable repos" from "we stopped looking".
- **Impact**: Onboarding/import for very large orgs silently omits active repos; a user importing "top 100" from such an org gets fewer with no explanation, and the shortfall looks like the org's reality.
- **Fix sketch**: Return `{ repos, exhausted: boolean }` (or attach a `truncated` flag when the loop ends with `url != null` at the page cap) so routes can annotate the response; document why 5×100 was chosen (latency/rate-limit budget for an unauthenticated route) next to the constant.
