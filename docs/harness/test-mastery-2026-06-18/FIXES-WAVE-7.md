# Test Mastery Fix Wave 7 — Orchestration & trust-boundary parse

> 7 atomic fix commits, **9 critical findings closed** (cumulative **55 / 60**).
> Suite: **996 → 1111 tests (+115), 0 failures.** tsc 0 source errors; `next build` **compiles successfully**.
> One behavior-preserving extraction (`repoKey`); the rest additive. Two more latent bugs surfaced and pinned-and-flagged.

## Commits

| Commit | Test file(s) | Findings closed |
|---|---|---|
| `e67459f` | `src/app/api/health/route.test.ts` (+6) | app-shell health no-leak |
| `8e79292` | `report/repoKey.ts` (new), `repoKey.test.ts` (+8), `ReportClient.tsx` (edit) | repo-report cross-repo identity |
| `65d562b` | `src/lib/report/validate.test.ts` (+63) | repo-report `parseScanReport` (+ history) |
| `f6c2361` | `src/lib/scan.test.ts` (+6) | scan-pipeline usage capture **+** llm-provider usability gate |
| `4d1ca03` | `src/lib/scan-alerts.test.ts` (+15) | fleet-alerts orchestrator **+** throw-safety |
| `36f01ae` | `src/lib/db/org-insights.test.ts` (+5) | fleet-rollups baseline asymmetry |
| `c3a3cda` | `src/lib/github/app.test.ts` (+12) | github-app token-mint/skew/self-heal |

## What was fixed (the invariant each test now pins)

1. **`/api/health` no-leak.** A DB-failure returns a generic 503 with **none** of 9 secret substrings (connection string, password, DSQL host, port, "token expired") in the body; anonymous GET works (no auth gate); autoscan-readiness truth table.
2. **`repoKey` cross-repo identity.** Different repos never collide; same-repo URL variants collapse equal per the real normalization; a crafted near-collision (`a/b-c` vs `a-b/c`) stays distinct. Verbatim extraction.
3. **`parseScanReport` trust boundary.** 63 cases: every required-field guard → `{ok:false}` (never a throw, never a half-valid object); null/array/`""` → `{ok:false}`; extra fields tolerated; `parseRepositoryHistory` drops malformed points individually without throwing.
4. **`scan.ts` metering + honesty.** A failed/throwing LLM attempt's tokens are excluded from `report.usage`; failover commits only the winning attempt; `isAssessmentUsable===false` degrades to `provider:"mock"` + "AI unavailable" warning (never branded real).
5. **`checkAndAlertRegression`.** A regression POSTs only to the resolving org's own webhook (no cross-tenant post); the fire/no-fire gate; per-org threshold override; throw-safety.
6. **`getOrgMovers` baseline.** Movers (`<= start` inclusive) vs rollup (strict `lt: start`) drift pinned over a shared dataset; a lone scan at `start` doesn't self-compare.
7. **`getInstallationToken` / `listInstallationRepos`.** Reuse-within-skew, re-mint-past-skew, NaN-expiry treated as expired (never stuck), 401 self-heal exactly once (no infinite loop), pagination + fork/archive filter.

## Two more latent bugs surfaced (pinned + flagged, not fixed)

1. **`scan-alerts` audit-suppresses-alert** (`scan-alerts.ts:71`) — `recordAudit` isn't `.catch`-wrapped, so an audit failure is throw-safe but silently drops a real regression alert (dispatch never reached).
2. **movers/rollup baseline asymmetry** (`org-insights.ts` vs `org-rollup.ts`) — `<= start` inclusive vs strict `lt: start` can show contradictory fleet movement.

(Running total of documented-and-pinned bugs across all waves: 7 — these two plus `minDimension:0` always-pass, briefing strength/risk overlap, orgsim axisScore deflation, `parseRepoUrl` host-suffix, and the `/api/health` no-try/catch tripwire.)

## Verification

| | After Wave 6 | After Wave 7 |
|---|---|---|
| Test files | 87 | 91 (+4 new) |
| Tests passing | 996 / 996 | **1111 / 1111** |
| tsc source errors | 0 | **0** |
| `next build` | (additive) | **compiles successfully** |
| Production source changed | 0 | 1 component (repoKey extraction) |

## Cumulative status

| Wave | Theme | Criticals closed |
|---|---|---:|
| 1 | Cross-tenant auth & IDOR | 11 |
| 2 | Money: charge / refund / reserve / dedup | 9 |
| 3 | Destructive writes & audit atomicity | 7 |
| 4 | Score / verdict integrity math | 8 |
| 5 | Frontend integrity (extraction + SSE) | 4 |
| 6 | Server-side tail (auth/IDOR/secrets) | 7 |
| 7 | Orchestration & trust-boundary parse | 9 |
| **Total** | | **55 / 60** |

## Patterns established (catalogue items 34–37)

34. **Secret-substring-absence assertion.** For a leak guard, assert a set of secret-ish substrings are ABSENT from the serialized error body, rather than asserting a specific safe shape — catches any refactor that spreads internals. *(health)*
35. **Drive-both-divergent-implementations.** When two functions must agree (movers vs rollup baseline), drive BOTH over one shared dataset and assert agreement, or pin the asymmetry as KNOWN — a future reconciliation breaks a test deliberately. *(org-insights)*
36. **Expiry-skew + NaN-expiry token cache.** Test reuse-within-skew, re-mint-past-skew, NaN/garbage expiry treated as expired (never stuck), and 401 self-heal exactly-once (no infinite loop). *(github/app)*
37. **Metering excludes failed attempts.** For usage/billing across retries/failover, assert only the winning attempt's tokens land in the metering basis; failed attempts contribute 0. *(scan)*

## What remains

**5 criticals remain** (the long tail): `estimateCoverage` cache-poison, `listGoals`/`plan.ts` achieved-state, `getPlaybookAdoption` lift math, segment-scoped rollup, manifest↔doctor round-trip. Plus the 76 Highs. A Wave 8 of 5 closes all 60 criticals.
