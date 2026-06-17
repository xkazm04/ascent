# Bug-UI Fix Wave 9 — GitHub API Resilience

> 2 atomic commits, 3 findings closed (2 high, 1 medium).
> Baseline preserved: `tsc` 0 → 0 errors · tests 502/502 → 509/509 (+7 new list tests).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `a5f963f` fix(github/list): paginate Link header + typed rate-limit error | github-repo-data #1, #2 | 2×High | `github/list.ts` (+test), `org/repos/route.ts` |
| 2 | `ed7054e` fix(api/org/import): validate untrusted repos[] coordinates | github-repo-data #5 | Medium | `org/import/route.ts` (+test fix) |

## What was fixed

1. **Org listing under-returned + never paginated (High).** `listOrgRepos` fetched one page of `per_page = count*2` and filtered forks/archived *after*, so for `count >= 50` a fork-/archive-heavy org returned far fewer than `count` (sometimes zero) and reported that short list as complete — a truncated/empty repo picker and silent under-importing. It now fetches full 100-repo pages and filters *inside* a `Link: rel="next"` pagination loop (cap 5 pages), backfilling slots lost to filtering.
2. **Rate limit / auth masked as 404 (High).** A 403/429/401 on the org probe threw straight through, and the route mapped every throw to 404 — so a rate-limit or auth outage read as "no such org" for a real account on a busy shared `GITHUB_TOKEN`. It now throws a typed `GitHubListError` (RATE_LIMITED/AUTH/NOT_FOUND/UPSTREAM) with `Retry-After`; the route maps RATE_LIMITED → 429, NOT_FOUND → 404, else 502.
3. **Untrusted `repos[]` reached GitHub URLs unvalidated (Medium).** `listOrgRepos` validates the org handle, but the client-supplied `repos[]` import path bypassed it — a crafted `../../enterprises/x` or control-char entry reached the GitHub helpers raw (a path-injection / SSRF-shaped surface on the anonymous-capable mock funnel). The route now validates every owner + name (via the exported `isValidHandle`/`isValidRepoName`) and rejects the batch on the first bad coordinate.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 502/502 | 509/509 |
| New tests | — | +7 (pagination, rate-limit mapping, validators) |

(Updating the import route's `@/lib/github/list` mock to include the new validators fixed 3 tests that broke when the route imported them — a mock-completeness fix, not a behavior change.)

## Patterns established (catalogue items 21–22)

21. **Filter inside the pagination loop, not after a single fetch.** When a list is filtered (forks/archived/permissions) and a fixed result count is promised, a one-page over-fetch silently under-returns once the filter rate is high. Follow the API's pagination cursor and keep filtering per page until the count is met or pages are exhausted.
22. **Don't collapse every upstream failure to one status.** Mapping all throws to 404 hides rate limits and auth outages as "not found." Classify the upstream status (429/403/401/5xx) into a typed error and map each to the right client status (with `Retry-After`), so operators and users can tell a typo from an outage.

## Deferred this wave (with rationale)

- **Governance/commit-activity vanish on 403/429 (github-repo-data #3, High).** A rate-limited governance read returns the same `null` as a genuinely-unprotected branch, so the busiest/most-governed repos get *under-credited* on D3/D6/D8. The fix adds a `rateLimited` sentinel so the analyzer **skips** the dimension instead of scoring it as absent — but that changes the **scoring-signal pipeline** (`applyGovernanceSignals`), a behavior change to maturity scores. **→ a scoring-pipeline change, deferred for care.**
- **PR pagination short-circuits on partial GraphQL pages (github-repo-data #4, Medium).** The page loop assumes each page yields `num` nodes; the partial-data tolerance breaks that, under-sizing the PR sample. Driving the loop off `hasNextPage`/`endCursor` is the fix — also touches the analyzer's sample-floor logic. **→ follow-up.**

## What remains

Remaining waves per INDEX: **W10 Accessibility** (`role=img` swallows links, chart SR fallbacks, unlabeled controls, focus management) · W11 UI states & consistency. All H/M/L.
