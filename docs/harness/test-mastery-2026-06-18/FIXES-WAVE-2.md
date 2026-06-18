# Test Mastery Fix Wave 2 — Money: charge / refund / reserve / dedup

> 6 atomic fix commits, **9 critical findings closed** (cumulative **20 / 60**).
> Suite: **592 → 664 tests (+72), 0 failures.** Baseline preserved: tsc 0 source errors, **0 production source changed**.
> Same isolation model as Wave 1 (subagent authors + self-verifies each file; orchestrator runs the full suite + tsc and commits atomically).

## Commits

| Commit | Test file(s) | Findings closed | Sev |
|---|---|---|---|
| `e354aab` | `src/app/api/scan/route.test.ts` (+11) | credits-entitlements #1 (`/api/scan` reserve/402/refund) **+** scan-pipeline refund ledger | 2C |
| `83f7372` | `src/lib/db/credits.test.ts` (+4) | credits-entitlements #2 `grantCredits` idempotency | 1C |
| `6e7cb54` | `src/lib/db/scans-persist.test.ts` (+10) | scan-persistence #1 commit-SHA dedup, #2 carry-forward | 2C |
| `632ad64` | `src/lib/rate-limit.test.ts` (+20) | quotas-rate-limiting #1 rate limiter, #2 `clientIp` trust | 2C |
| `770db8b` | `src/lib/pool.test.ts` (+15) | org-import #1 `mapPool` exactly-once/cap | 1C |
| `2d2ba0c` | `src/app/api/cron/rescan/route.test.ts` (+12) | org-import #2 cron auth/claim/refund | 1C |

## What was fixed (the invariant each test now pins)

1. **`/api/scan` money flow.** Reserve fails / zero balance → **402** with no scan and no charge; a real metered scan charges once and is **not** refunded; **degrade-to-mock / dedup / scan-throws** each refund exactly once via `grantCredits(org,1,{reason:"refund"})`; the public weekly-quota slot refunds on the same branches. Closes the cross-context dedup (credits #1 = scan-pipeline refund ledger — one file, two findings).
2. **`grantCredits` idempotency.** Same-`externalId` redelivery short-circuits (no second ledger row, balance not doubled); a concurrent P2002 is swallowed; a P2002 **without** an `externalId` still propagates (swallow scoped to redelivery).
3. **`persistScanReport` dedup + carry-forward.** Same sha → `deduped:true`, `scan.create` never called (cross-instance P2002 re-reads the winner); a new sha creates exactly once; carry-forward preserves `status`/`assigneeLogin`/`targetDate` by recommendation **identity** (real `matchRecommendations`), reorder-proof.
4. **`rate-limit` + `clientIp`.** Per-IP window trips at limit+1 and re-opens after it slides (fake timers, `Retry-After == 60`); the global spend backstop trips independently; `clientIp` trusts the **right-most** forwarded hop so a spoofed left-most `x-forwarded-for` cannot mint fresh per-IP buckets (missing header → shared `"unknown"`, fail closed).
5. **`mapPool`.** Exactly-once (output length == input, no drop/dup) at concurrency 1/=n/>n; input-order preserved when tasks resolve out of order; live-concurrency peak == `min(cap, n)` (real parallelism proven via deferred promises); `Math.max(1,..)` floor + `Math.min` clamp hold; a rejecting task rejects the pool without double-invoking any index.
6. **`cron/rescan`.** Missing `CRON_SECRET` fails closed (503); wrong bearer/key → 401 with nothing claimed/scanned/charged; `claimRescan` runs **before** `scanRepository` keyed to `(repoId, schedule)` so two overlapping due entries scan only the CAS winner (no double-bill); a charged scan that throws refunds exactly once and advances the schedule.

## Notable: a finding partially corrected by reality

The scan-pipeline report listed **low-coverage** as a refund branch. The route's actual behavior is that a low-coverage scan **keeps its charge** and only skips caching. The test pins the *real* behavior (charge-kept), not the report's assumption — this is the intended test-mastery discipline (pin observable behavior). Whether low-coverage *should* refund is a product decision, logged here, not silently encoded.

## Verification

| | After Wave 1 | After Wave 2 |
|---|---|---|
| Test files | 62 | 66 (+4 new, 2 extended) |
| Tests passing | 592 / 592 | **664 / 664** |
| tsc source errors | 0 | **0** |
| Production source files changed | 0 | **0** |

## Cumulative status

| Wave | Theme | Criticals closed |
|---|---|---:|
| 1 | Cross-tenant auth & IDOR | 11 |
| 2 | Money: charge / refund / reserve / dedup | 9 |
| **Total** | | **20 / 60** |

**Deferred from Theme B (not in this wave):** scan-pipeline #2 (`scan.ts` usage capture — a *failed* LLM attempt's tokens must stay off `report.usage`, the metering basis) lives in `scan.ts`, not the route; it folds into a Theme-B second pass or Wave 4 (it is partly a scoring/metering-math gap).

## Patterns established (catalogue items 7–12)

7. **Deterministic concurrency via deferred promises + live-counter peak.** Test a pool/semaphore by tracking a counter (inc on task start, dec on resolve) and asserting the observed peak `== min(cap, n)` — resolve the deferreds in a chosen order. Never timing/`setTimeout`-based (flaky). *(pool)*
8. **Fake-timer window testing for limiters.** `vi.useFakeTimers()` + advance past the window to prove the slide; assert the strict `t > cutoff` edge at `windowMs-1` vs `windowMs+1`. *(rate-limit)*
9. **"Spoof can't evade" trust-boundary assertion.** For any IP/identity bucket key, assert a forged value (extra left-most XFF hop) does **not** mint a fresh bucket — pin which hop the code actually trusts. *(rate-limit/clientIp)*
10. **Refund-ledger branch matrix.** For a money route, enumerate every non-product branch (degrade/dedup/throw/low-coverage) and assert refund fires once — or, where it doesn't, pin the real charge-kept behavior and log the product question. *(scan route)*
11. **Idempotency via unique-constraint simulation.** Make the fake `create` throw `{ code: "P2002" }` to drive the dedup-swallow, and assert the swallow is **scoped** (a P2002 without the idempotency key still propagates). *(credits)*
12. **Pin real behavior over the report's assumption.** When a finding assumes a branch behaves one way but the code does another, the test pins observable behavior and surfaces the discrepancy — it never encodes the assumption as if it were the spec. *(low-coverage charge-kept)*

## What remains

Themes C–G + the 76 Highs. Next recommended: **Wave 3 — destructive writes & audit atomicity** (`openDraftPr` overwrite guard, `cron/purge` auth, `updateRecommendation` txn+audit [closes 2 cross-context findings], `pruneRepoScans` selection, members last-owner guard).
