# Biz+Bug Fix Waves 5–6 — Medium bug tail (subagent-parallel, per-group)

> 10 commits across 2 waves, **52 Medium bug findings closed** (0 regressions).
> Pattern: ≤5 edit-only subagents/wave (one per context group, disjoint files); orchestrator ran
> tsc + full vitest and committed per group. Baseline preserved: tsc 0; vitest 2635→2637 pass /
> 1 pre-existing env-fail (`db/client.test.ts` dsql-signer).

## Wave 5 (22 closed) — reporting, planning, marketing, data, billing
| Group | Closed | Commit |
|---|---:|---|
| Marketing/design | 5 | `cc7de0f` (DeckNav race/a11y, ScanModal SSR-suspense, About coupling/fs) |
| Reporting | 5 | `f8728c4` (409 refetch, DimensionTrends abort, chart a11y links, TTFB Promise.all, re-test deps) |
| Billing | 3 | `a400e02` (unknown-org signal, usage slug, badge-impression bound) |
| Planning | 5 | `b881cb8` (war-room credit cap, initiative data-loss, edit snap-back, goal delete/validate) |
| Data | 4 | `49d5c82` (retention time-budget+rotation, purge 500-on-errors, leaderboard scope, latest-scan tie-break) |

## Wave 6 (30 closed) — identity, onboarding, org-scanning, org-dashboard, repo-scanning
| Group | Closed | Commit |
|---|---:|---|
| Identity | 5 | `b26cd51` (timed discovery, CODEOWNERS cap, GraphQL partial flag, CSRF host, session determinism) |
| Onboarding | 8 | `a098fa6` (404/error resilience+telemetry, fleet race/silent-fail, toggle race, mock-on-paid, slug, stall) |
| Org-scanning | 7 | `04059eb` (digest timeout+parallel, alert-save UX, plan default, slug canon, import cap+race, scan slug) |
| Org-dashboard | 5 | `7ce4435` (branding rejection signal, no phantom-org, segments N+1, PR attribution, owner case) |
| Repo-scanning | 5 | `e396f3f` (gate honors saved policy, headSha re-resolve, LLM shape guard+sanitize, sandbox predicate) |

## Regressions caught + fixed-forward (verify-after-each-wave earned its keep)
- **Wave 5:** `credits.test.ts` pinned the old 4-field `consumeScanCredit` deny shape; the added
  `orgExists` field broke the exact-match → updated the assertion (the distinguishing signal is the fix).
- **Wave 6:** a self-referential TS7022 in `graphql.ts` (the new `{data,partial}` return) → annotated the
  `resp` binding. `alerts.test.ts` (composed AbortSignal, not raw) + `importScan.test.ts` (STALL_MS
  45→120s) updated to the corrected behavior. **Sticky-comment endpoint change reverted** (broke 5
  `write.test.ts` cases — a careful test rewrite is a focused follow-up).

## Deferred (with cause)
- **Sticky PR-comment dedup endpoint (Med, `checks.ts`)** — the repo-level `sort=desc` rewrite is correct
  but needs 5 `write.test.ts` cases rewritten to the new API interaction; reverted for now.
- **Fleet commit-activity week bucketing + org-signals slug routing (Med, `org-signals.ts`)** and
  **overview peripheral-fetch isolation (Med, `org/[slug]/page.tsx`)** — both files were being **actively
  edited in the maintainer's concurrent WIP** (org-overview refactor + new passport/stack features), so
  these fixes were held back to avoid entangling that work. (The core slug-canonicalization fix landed via
  `org-shared.ts getOrgBySlug`, which the rollup family reads.)
- Schema/architecture/product deferrals from the scan stand (monthly-allowance atomic counter, cross-
  instance rate-limit store, ledger `kind` column, gatePolicy JSON→TEXT, benchmark private-repo scope,
  contributor-PII export, two-auth-systems consolidation, self-attested conformance beyond the score bound,
  totally-failed-scan `incomplete` flag, share-token revocation, playbook lift attribution).

## Note — concurrent working-tree edits
During Wave 6 the ascent working tree showed substantial **concurrent maintainer WIP** (new
`OrgScoreBadges`/`PassportPortfolio`/`StackMatrix`/`RepoDimension*`/`SecurityRiskRegister` components,
a `useLiveWarRoom` hook, org-page refactors, `org-teams`/`tech-groups`/`briefing`/`db/index` edits). All
Medium fixes were committed **by explicit path** — the WIP was never staged, git-added-all, stashed, or
reset. Two of our target files (`org/[slug]/page.tsx`, `org-signals.ts`) overlapped that WIP and were
left uncommitted (fixes deferred).

## Cumulative (all waves)
**69 findings closed** total: 1 Critical + 10 High + **57 Medium** + 1 Low, across Waves 1–6, 0 net
regressions. Branch `vibeman/biz-bug-scan-2026-06-29`; `master` untouched at `c8e04c3`.
