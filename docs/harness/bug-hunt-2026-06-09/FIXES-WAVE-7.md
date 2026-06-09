# Bug Hunter Fix Wave 7 — Public-surface input validation & data completeness

> 5 fix commits, 7 findings closed (usage #7 was already mitigated — no change needed).
> Baseline preserved: tsc 0 → 0 errors · tests 260/260 · eslint clean · **next build passes**.
> Branch: `vibeman/bug-hunt-2026-06-09` (off `master`).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `a841144` | usage #1 + #2 | High + Medium | badge/[owner]/[repo]/route.ts |
| 2 | `e30a436` | usage #6 | Medium | api/usage/route.ts |
| 3 | `cd56f78` | scan-pipeline #4 | Medium | github/source.ts |
| 4 | `d45a1d7` | gh-app #2 | High | github/graphql.ts |
| 5 | `8605918` | gh-app #3 | High | webhook/route.ts, db/installations.ts, db/index.ts |
| — | (no change) | usage #7 | High | already mitigated — see below |

## What was fixed (grouped by sub-pattern)

### Untrusted-input bounds on the public badge
1. **Uncapped label/logo + lax name validation** (`a841144`, High + Medium). `?label=` and `?logo=data:image/...` were unbounded on the unauthenticated, embeddable badge — a response-amplification lever (and a broken giant badge). Capped label to 80 chars and the logo data-URI to 4 KB. Separately, `validName` only excluded the bare `"."`/`".."` strings, so `.git`/`..foo`/`a..b` passed despite the comment; now rejects a leading dot and any consecutive dots (a real dotted repo like `react.dev` still validates).

### Unauthenticated query cost
2. **Public usage window DoS** (`e30a436`, Medium). The `days` clamp bounded to [1,365], but the unauthenticated `public` org could repeatedly force a 365-day, ~10-aggregate scan. Capped the public window to 90 days; authenticated orgs keep the year.

### URL parsing
3. **Explicit non-GitHub URL rejection** (`cd56f78`, Medium). An explicit URL (with a scheme) to a non-GitHub host fell through to bare-parsing its `scheme/host/path` as owner/repo, relying on the charset check's stray-colon to reject it. Now rejected deterministically; the scheme-less `owner/repo` shorthand is preserved (the leading-dot heuristic still rejects `gitlab.com/a/b`).

### Data completeness
4. **PR ingestion pagination** (`d45a1d7`, High). `fetchPullRequests` issued ONE request capped at 100, silently truncating any larger ask while `totalCount` reported the real count. Now walks pages with a cursor up to `limit` (bounded by MAX_PAGES = 1000 PRs), mirroring `listInstallationRepos`. Default limit (40) is one page → no score shift; the sample was already disclosed to the LLM as "N analyzed of M total", so this just removes the latent >100 ceiling.
5. **installation_repositories reconciliation** (`8605918`, High). The handler was removal-only, so a "selected → all" flip (empty `repositories_removed`) or a paginated "all → selected" narrowing left stale watched repos 401ing their scheduled rescan forever. Added `reconcileWatchedRepos` (unwatch any watched repo not in the live set) and a DEFERRED reconcile via `listInstallationRepos` after the 2xx. Fail-safe: a listing that throws SKIPS, so a transient error can't be misread as "zero repos" and wipe the watch set.

## Already-mitigated (no change)
- **usage #7 (rate-limit bucket collapse)**: `clientIp` was already hardened — it prefers `x-real-ip`, then the RIGHT-most XFF hop, then a deliberate fail-closed `"unknown"` bucket (limit unidentifiable callers collectively). That IS the fix the finding asks for; flagged because the subagent read the collapse as a bug rather than the intended fail-closed design.

## Verification table

| Gate | After Wave 3 | After Wave 7 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 260 passed / 260 | 260 passed / 260 |
| `eslint` (changed) | clean | clean |
| `next build` | passes | passes |

## Cumulative status (across all waves so far)

| Wave | Theme | Findings closed |
|---|---|---|
| 1 | Concurrency, dedup & billing integrity | 7 |
| 2 | Auth, webhook & session integrity | 7 |
| 3 | Resilient rendering & empty-data UX | 8 |
| 7 | Public-surface input validation & completeness | 7 |
| | **Total** | **29 / 70 — all 3 Criticals + 12 of 21 Highs closed** |

## Patterns established (catalogue items 13–15)

13. **Bound every caller-supplied dimension on a public endpoint** — label/logo/window/page-size params on an unauthenticated route are all amplification/DoS levers. Cap length AND cost; for an unauthenticated tier, cap tighter than the authenticated one.
14. **Reconcile against the source-of-truth, don't trust the delta** — a "what changed" webhook (removed rows) is incomplete by design (empty on an all-flip, paginated on a narrowing). Periodically re-list the live set and reconcile, with a fail-safe so a failed listing is never read as "empty set" and used to wipe state.
15. **Pagination ceiling ≠ disclosed sample** — surfacing `totalCount` tells a consumer it's a sample, but a hard single-request cap still silently truncates a caller asking for more. Fix both: disclose the sample AND let the fetch honor the requested size (bounded).

## What remains

Open themes per the INDEX (41 of 70 still open, 0 Critical): LLM provider resilience (Wave 4 — 3 Highs), Scoring/maturity math (Wave 5), SSE lifecycle & cache staleness (Wave 6), Persistence & DSQL token lifecycle + residual polish (Wave 8 — incl. the deferred org-scan #5 movers baseline, and oauth #4/#6/#7).

### Deferred this wave (kept the wave at 7 fixes)
- **org-scan #5** (movers windowed baseline drops mid-period-onboarded repos): off-theme (org aggregate, not public input) — moved to Wave 8.
