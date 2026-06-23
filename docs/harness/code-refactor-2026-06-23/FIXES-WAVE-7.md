# Code Refactor — Fix Wave 7: Billing / quota orchestration (COMPLETE)

> 2 commits, 2 High findings closed (the last unclosed Highs — the money paths).
> Baseline: tsc 0→0 · tests 2610 (UNCHANGED; route tests pass identical — including
> the stream test that exists specifically to catch this drift).

These were held for last and treated conservatively (credit + quota correctness).

| # | Commit | Finding | What was extracted (behavior-identical) |
|---|---|---|---|
| 1 | `refactor(scan-credit): extract the per-repo credit reserve/refund loop …` (`f0b11bc`) | org-import #1 | `src/lib/scan-credit.ts`: `reserveScanCredit` (consume + skip predicate + low-credit alert), `refundScanCredit`, `shouldRefundScan` (mock‖deduped policy), `logPartialWrites` (route-tagged warn). Routed org/import, org/scan, cron/rescan through them; each keeps its own progress surfacing + per-repo scan options. Route tests 26/26 unchanged. |
| 2 | `refactor(scan-finalize): unify the JSON + SSE scan routes' post-scan orchestration` (`fae929e`) | scan-pipeline #2 | `src/lib/scan-finalize.ts`: `consumeScanQuota` (weekly public-quota consume → header fields + refund thunk + a `blocked` Response), `classifyScanResult` (`degradedToMock`/`lowCoverage`), `cacheAndPersistScan` (cacheSet + persist-with-partial-warn behind the shared guard). Both scan routes call them; each keeps its surfacing + refund timing. Both route tests 16/16 unchanged. |

The helpers bind to the same mocked module paths the route tests already mock (`@/lib/db`, `@/lib/cache`, `@/lib/public-scan-quota`, `@/lib/scan-alerts`), so the existing tests now guard the single implementation.

## Status: all 43 High findings closed (across waves 1–7), 0 regressions.
