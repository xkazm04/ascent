# Test Mastery Fix Wave 3 — Destructive writes & audit atomicity

> 6 atomic fix commits, **7 critical findings closed** (cumulative **27 / 60**), plus several Highs (retention selection, apply-409 surfacing).
> Suite: **664 → 723 tests (+59), 0 failures.** Baseline preserved: tsc 0 source errors, **0 production source changed**.

## Commits

| Commit | Test file(s) | Findings closed | Sev |
|---|---|---|---|
| `ca881e5` | `src/lib/github/write.test.ts` (+7) | practices #1 `openDraftPr` overwrite guard (+ playbooks shared surface) | 1C |
| `7c350da` | `src/app/api/cron/purge/route.test.ts` (+12), `src/lib/db/retention.test.ts` (+11) | data-retention #1 purge auth, #2 `pruneRepoScans` selection | 1C+1H |
| `5933455` | `src/lib/db/scans-recommendations.test.ts` (+6) | backlog #1 **+** roadmap #1 `updateRecommendation` (cross-context) | 2C |
| `75f0d54` | `src/lib/db/members.test.ts` (+10) | members #1 last-owner guard | 1C |
| `d667e83` | `src/app/api/practices/apply-batch/route.test.ts` (+8), `apply/route.test.ts` (+6) | practices #2 apply/apply-batch tenant gate + caps | 1C |
| `9aa575d` | `src/app/api/org/playbooks/[id]/apply/route.test.ts` (+5) | playbooks #1 apply tenancy + 409 mapping | 1C |

## What was fixed (the invariant each test now pins)

1. **`openDraftPr` overwrite guard.** When a file already exists on the **base** branch, `openDraftPr` throws `AppApiError(409)` and issues **zero** content PUTs — never a false success. The guard is base-specific (a file present only on the generated branch does not trip it). This is the single guard between an `apply-batch` click and mass file-loss across 25 customer repos.
2. **`cron/purge` + `pruneRepoScans`.** Missing/empty `CRON_SECRET` fails **closed** (503); a wrong bearer/key is 401 with the prune fns never called; a thrown purge is 500 not 200. `pruneRepoScans` keeps the newest `max` scans (`orderBy createdAt desc` + `skip = max`) so a backdated `scannedAt` can't get a live newer scan deleted; per-org isolation holds; the `0`-policy is a no-op.
3. **`updateRecommendation` atomicity.** On a real change the recommendation `update`, the `recommendationEvent.createMany`, and `auditLog.create` are all invoked on the **same `tx`** handed to `$transaction` — so no committed change can ship without its audit row. A no-op patch opens no transaction. Closes the critical flagged by **both** Backlog and Roadmap (one fix, two findings).
4. **Members last-owner guard.** Demoting/removing an org's **only** owner returns `"last_owner"` with no write; one-of-several owners succeeds; the owner count is read inside the **same `tx`** as the write (TOCTOU-safe). The guard was previously never executed (`isDbConfigured:false` stub).
5. **Practices apply / apply-batch tenant gate.** A caller without org access → 403 with no PR-write attempted; a batch spanning two owners → 400 refused before the gate; a 30-repo batch caps at `MAX_BATCH=25` (25 written, 5 skipped); one bad repo doesn't abort the pool.
6. **Playbooks apply tenancy.** A caller without access to the **playbook's** org → 403 (gated on the playbook's org, not the caller-supplied repo) with no token mint / no PR write; owner-mismatch → 400. The 409→**502** mishandling is pinned as current behavior so a future fix to 409 is a deliberate, test-visible change.

## Verification

| | After Wave 2 | After Wave 3 |
|---|---|---|
| Test files | 66 | 72 (+6 new, 2 extended) |
| Tests passing | 664 / 664 | **723 / 723** |
| tsc source errors | 0 | **0** |
| Production source files changed | 0 | **0** |

## Cumulative status

| Wave | Theme | Criticals closed |
|---|---|---:|
| 1 | Cross-tenant auth & IDOR | 11 |
| 2 | Money: charge / refund / reserve / dedup | 9 |
| 3 | Destructive writes & audit atomicity | 7 |
| **Total** | | **27 / 60** |

## Patterns established (catalogue items 13–18)

13. **Same-tx atomicity assertion.** Model `$transaction(fn)` as running `fn(tx)` against a spy `tx`; assert every write (update + event + audit) lands on the `tx`, not the top-level client. Proves "no committed change without its audit row." *(scans-recommendations)*
14. **Guard returns a discriminated result, not a throw.** Pin the actual signal (`"last_owner"`, 409, 400) **and** that no write side-effect occurred — richer than asserting an exception type. *(members, write, playbooks)*
15. **Selection-preserves-newest.** For a prune/delete, assert the KEEP set (newest `max` via `orderBy`+`skip`) so a regressed/backdated selection can't delete a live row; assert an empty selection never opens a transaction. *(retention)*
16. **Pin-divergence-as-current-behavior.** When a route mishandles an error (409→502), assert today's behavior explicitly and comment that a fix must flip the assertion — the bug stays visible and its fix deliberate. *(playbooks)*
17. **Real-error-class preservation in mocks.** Use `vi.importActual` + spread so `instanceof AppApiError`/`GitHubError` branches stay intact when mocking the module that throws them. *(write, practices, playbooks)*
18. **Ref-specificity companion test.** When a guard keys on a specific ref (base branch), add a companion proving it does NOT trip on the other ref — pins the precise condition, not just the happy reject. *(write)*

## What remains

Themes D–G + the 76 Highs. Next recommended: **Wave 4 — score/verdict integrity math** (`sanitizeGatePolicy`, `assembleReport` blend + failed-detector, `levelForScore` band boundaries, `computeWindowDeltas`, `buildExecBriefing`, `projectGoal`, `orgsim` axisScore) — all pure / LLM-batchable, lowest risk, no source changes expected.
