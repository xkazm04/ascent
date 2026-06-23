# Code Refactor — Fix Wave 1: Dead-code removal

> 9 commits, 9 findings closed (8 High + 1 Medium, all `dead-code`).
> Baseline preserved: tsc 0→0 · tests 2585→2584 (−1 = the one test that existed
> only to exercise deleted code; **0 regressions**).

Pure subtraction wave — every target was grep-verified zero-caller before deletion.

## Commits

| # | Commit | Finding closed | Sev | Files |
|---|---|---|---|---|
| 1 | `refactor(landing): delete dead ScanGallery component` | scan-pipeline #1 | High | −1 file (~130 LOC) |
| 2 | `refactor(report): delete dead ReportTabBar, inline the ReportTab type` | repo-report-shell #1 | High | −1 file (74 LOC), ReportView |
| 3 | `refactor(db): delete dead getOrgContributors + OrgContributor type` | fleet-rollups #1 | High | org-contributors, org, index |
| 4 | `refactor(db): delete dead unwatchReposForInstallation` | github-app-webhooks #1 | High | installations, index, webhook test |
| 5 | `refactor(db): delete dead simulateOrgFix single-fix wrapper` | goals-initiatives #1 | High | plan, index |
| 6 | `refactor(db): delete dead updateRecommendationStatus wrapper` | roadmap-tracking #1 | Med | scans-recommendations, index, scans |
| 7 | `refactor(landing): remove dead Flight-Deck matrix/ramp helpers` | landing-prototypes #1 | High | matrixData, levelRamp, matrixData.test |
| 8 | `refactor(db): drop cross-domain @/lib/db -> forecast re-export` | database-client #1 | High | index |
| 9 | `refactor(db): delete dead advanceSchedule` | org-import #4 | Med | org-watch, org, index |

## What was removed

- **Two whole dead components.** `ScanGallery` (superseded by `IndexGallery`) and `ReportTabBar` (the tab switcher migrated to `SideNav`; only its `ReportTab` *type* survived, now inlined in `ReportView`).
- **Five dead DB exports.** `getOrgContributors` (superseded by `getContributorInsights`), `unwatchReposForInstallation` (superseded by `reconcileWatchedRepos`), `simulateOrgFix` (forwarder to `simulateOrgFixes`), `updateRecommendationStatus` (back-compat wrapper), `advanceSchedule` (orphaned by the claim-based cron refactor) — each with its barrel re-export(s).
- **A cross-domain barrel leak.** `@/lib/db` re-exported `@/lib/maturity/forecast`; no caller reached it through the db barrel.
- **Flight-Deck prototype leftovers.** `weightTint`/`weightText`, the `ArchetypeKey` type, the write-only `MatrixRow.short` field, and the never-called `levelHex` wrapper.

## Test plumbing touched (and why it was safe)

- **webhook route.test.ts** — removed the `unwatchReposForInstallation` mock/import/`mockUnwatch` const and the 3 `expect(mockUnwatch).not.toHaveBeenCalled()` tripwire assertions. The tests **keep** their `mockReconcile` assertions, which are the real regression guard (teardown goes through the GitHub-confirmed reconcile, not the deleted blind path).
- **matrixData.test.ts** — dropped the one `weightTint/weightText` case + its imports (the functions are gone). This is the single net test-count decrease (2585→2584).

## Patterns established (catalogue items 1–3)

1. **Back-compat / forwarder wrapper rot** — a thin `fnX → fnXs` (singular→plural) or `fnX → fnY(opts)` wrapper outlives the migration that introduced it; grep the singular form with a word boundary (`\bsimulateOrgFix\b`) to separate it from the survivor it forwards to.
2. **Tripwire-only dead code** — a function kept alive solely by a test asserting it's *never* called. Deleting it is safe **iff** the same test also asserts the replacement path positively; strip the tripwire, keep the positive assertion.
3. **Cross-domain barrel re-export** — a barrel (`@/lib/db`) re-exports a neighbouring domain (`maturity/forecast`) "for convenience." Verify with a multiline grep for those symbols imported *from the barrel path* — if zero, the re-export is dead and drops a phantom dependency for every barrel importer.

## What remains

Waves 2–7 per INDEX: security/safety primitives (W2), infra plumbing (W3), scoring/domain logic (W4), UI constants & chips (W5), UI components & markup (W6), Medium/Low tail (W7). One held item: the tenant-read IDOR-gate unification (behavior-affecting — awaiting explicit sign-off).
