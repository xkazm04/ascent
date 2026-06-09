# Bug Hunter Fix Waves 5, 6 & 8 — Scoring math · SSE/cache · Persistence & polish

> Run together to drain the remaining backlog. 9 fix commits, 22 findings closed; 8 reviewed-without-code (intended-design / already-mitigated / benign) or deferred-Low.
> Baseline preserved: tsc 0 → 0 errors · tests 260/260 · eslint clean · next build passes.
> Branch: `vibeman/bug-hunt-2026-06-09` (off `master`).

## Wave 5 — Scoring / maturity math (6 fixed, 1 reviewed)

| Commit | Findings | Severity |
|---|---|---|
| `e5d0f99` | maturity #1 + #2 | High + Medium |
| `c52a37d` | maturity #3, org-dash #7 | Medium + High |
| `178df27` | maturity #5 + #6 | Low + Low |

- **NaN coverage poison** (#1, High): `clamp` (Math.max/min) propagates NaN, so a non-finite `snap.coverage` collapsed EVERY blended score/overall/axis/level/posture to NaN. Default a non-finite coverage to full.
- **Coverage miscount** (#2, Med): the partial-LLM-coverage warning counted over raw `signals.length`, which includes dimensions dropped before the blend → overstated coverage ("9 of 9"). Count over the blended set.
- **Small-sample governance** (#3, Med): `aiGovernedRate` derived at `aiInvolved >= 3` dragged D8 off a 3-PR sample; raised to 5.
- **Champions theater** (org-dash #7, High): a solo Copilot user rendered as a celebrated "#1 ★ champion" / "100% AI-active". Gate the leaderboard on >= 3 contributors.
- **Unchecked roadmap fields** (#5/#6, Low): validate the LLM's `levelUnlock` (canonical `Lx->Ly`, no downgrade/out-of-range) and enforce the recommendation `targetDate` YYYY-MM-DD contract.
- **maturity #4 reviewed — NOT a bug**: glass-box `signed` deliberately re-centers on the displayed rounded headline so `sum(signed)` surfaces the parts-vs-headline gap; pinned by the "residual = rounding only" test. Comment added.

## Wave 6 — SSE lifecycle & cache staleness (6 fixed, 2 reviewed)

| Commit | Findings | Severity |
|---|---|---|
| `f74360d` | scan-pipeline #6 + #7 + #3 | Medium + Medium + Low |
| `bf32d68` | scan-pipeline #5 | High |
| `bf2abea` | usage #3, report #6 | Medium + Medium |

- **Coverage cache pin** (scan-pipeline #5, High): `estimateCoverage` pinned small repos at 0.95 ignoring `fetched`, so a blip-degraded small-repo scan read as fully covered and got CACHED for the full TTL. Scale by the fetch success rate (`fetched/attempted`).
- **Abort as error** (#6, Med): the stream catch reported a client-disconnect AbortError as "Unexpected error"; special-case it (no frame), and stop the keepalive at the terminal frame (#3, Low).
- **Backoff ignores abort** (#7, Med): `fetchCommitActivity`'s 202 backoff held the connection up to 3s after disconnect; made it abort-aware.
- **Stale badge / ETag** (usage #3 / report #6, Med): a SHA-less badge no longer gets the 10-min resolved TTL (downgraded to neutral); the history ETag folds in the newest row's `scannedAt`+`overallScore` so an in-place correction invalidates it.
- **scan-pipeline #2 reviewed — already covered** by the existing `finally` + `cancel()` (the only unguarded window has no throwable code).
- **scan-pipeline #8 reviewed — deliberate tradeoff**: the optimistic byte reservation prevents the check-then-act overshoot race; its transient under-read is bounded and safe-side.

## Wave 8 — Persistence, DSQL & residual polish (10 fixed, 1 benign, 3 deferred-Low)

| Commit | Findings | Severity |
|---|---|---|
| `9baa3d7` | persistence #1 + #2 + #3 + #5 | High×3 + Medium |
| `ae48517` | oauth #4 + #6 + #7 | Medium + Low + Low |
| `5cb8ded` | org-scan #5, org-dash #4, report #4 | Medium×3 |

- **Audit invisibility** (persistence #1, High): recommendation-update audit rows were written `orgId: null`, but the only reader filters `where:{orgId}` — durable but unreadable. Resolve the org via recommendation→scan→repo.
- **DSQL token lifecycle** (persistence #2+#3, High×2): the cold start credited the deploy-time token a FULL TTL, blinding `tokenIsStale`; a then-failing refresh would pin the stale client forever. Seed `expiresAt: 0` so refresh keeps firing until our own token lands — fixes both.
- **Negative limit** (persistence #5, Med): clamp `getRepositoryHistory`'s limit so a negative `take` can't return oldest-first.
- **OAuth polish** (oauth #4/#6/#7): URL-built resync redirect (handles fragments), surfaced `error_description`, matched cookie-clear attributes.
- **Display correctness** (org-scan #5 / org-dash #4 / report #4, Med×3): mid-period-onboarded repos kept in movers; honest stale-scan progress denominator; aligned the per-dimension trend fetch limit with the overall series.
- **persistence #7 reviewed — benign**: `cacheDelete` is idempotent, so a re-run on a withRetry retry is harmless.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 260 passed / 260 |
| `eslint` (changed) | clean |
| `next build` | passes |

## Patterns established (catalogue items 19–21)

19. **Re-verify a scan finding against the real code before fixing** — across these waves ~8 findings were already-mitigated, intended-by-design, or guarded. Reading the actual code (not the finding's premise) avoided breaking a tested invariant (maturity #4) and re-implementing existing guards.
20. **One root cause can close several findings** — the DSQL cold-start `expiresAt: 0` change closed persistence #2 AND #3; they were two symptoms of the same optimistic-TTL trust boundary.
21. **Fail-safe a reconcile/refresh against its own failure** — a token refresh that fails must not leave a far-future validity (it would suppress retries); a watch reconcile that fails must not be read as "empty set." Make the failure path keep retrying, never pin a wrong state.
