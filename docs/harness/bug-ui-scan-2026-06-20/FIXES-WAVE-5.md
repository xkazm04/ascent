# Fix Wave 5 — Scoring / aggregation correctness (ascent, bug-ui-scan-2026-06-20)

> 8 findings closed (7 distinct fixes — two roots each surfaced in two contexts) in 7 atomic commits.
> Baseline preserved: tsc 0; tests 2396 → 2398 (+2 regression tests); `next build` green. 0 regressions.
> Calibration-safe: every fix changes only the degenerate/edge case (a dropped dim, a ≤2-point fit, a
> mismatched-week sum, a no-data compare); the full-coverage path is unchanged.

## Commits

| Commit | Finding(s) | Sev | What changed |
|---|---|---|---|
| scoring | maturity-model-scoring-engine #1 | High | `assembleReport` passes `isPresent` to `axisScore` for adoption+rigor, so a dropped/failed detector dim is renormalized out of the axis instead of charged 0×full-weight (was deflating the axis + flipping posture). No-op when all 9 dims present. |
| fleet (activity) | fleet-rollups-insights #1 | High | `getOrgActivity` buckets each repo's weekly series by absolute calendar week, not array index — heterogeneous-cadence fleets no longer sum mismatched weeks. |
| fleet (cohort) | fleet-rollups-insights #2 | High | `getOrgBenchmark` percentiles the org mean vs other ORG means (was org-mean vs peer per-repo distribution — a unit mismatch). |
| governance | ci-gate-status-checks #1 ≡ practices-governance-adoption #1 | High | `buildGovernanceOverview` now threads `protected`/`govReadable` into `evaluateGateLite`, so the fleet view enforces the same `requireProtectedBranch` bar the copied CI gate does (dashboard↔CI drift). Readable-gated → absent governance skipped (no false-fail). |
| gate | ci-gate-status-checks #2 | High | `GatePolicyEditor` round-trips a custom D9 Security floor (was hardcoding it to 50 on save). |
| forecast | investment-simulator-forecast #1 ≡ org-overview-standing #2 | High | `forecastTrajectory` flags `lowData` (<3 points); Trajectory shows "low data (n=…)" not a 100%-confidence ETA from a 2-point (R²=1) fit. Raw fitQuality math untouched. |
| org-overview | org-overview-standing #1 | High | OrgStanding shows "not enough history to compare" when `comparedRepos === 0` instead of a success-theater "no regressions" chip. |

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `vitest run` | 2396 | **2398** (+2: heterogeneous-cadence activity, 2-vs-3-point forecast) |
| `next build` | green | green |
| Regressions | — | none |

Note: `npm run bench` (the calibration eval) is an HTTP eval against a running server and was not
runnable headless — calibration is otherwise covered by tsc=0 + the engine/gate/forecast unit tests,
and every fix is scoped to a degenerate case that doesn't touch the calibrated full-coverage path.

## Patterns added

20. **A roll-up must renormalize "couldn't measure", not fold it as 0.** Apply the same `isPresent`
    exclusion on every axis/sub-roll-up, not just the headline. (maturity #1)
21. **Aggregate time-series by the real time key, not array position.** Right-aligning per-series arrays
    sums different calendar periods for sources with different cadences. (fleet #1)
22. **Percentile like-for-like.** Ranking a scalar (org mean) against a distribution of a different unit
    (per-repo scores) is meaningless. (fleet #2)
23. **A dashboard that mirrors a gate must feed the gate evaluator the same inputs.** Omitting a rule's
    operands silently disables it on one surface. (governance)
24. **A goodness-of-fit metric is undefined/degenerate at minimal n.** Gate "confidence" on enough
    points; don't render R²=1 from 2 points as certainty. (forecast)

## Deferred from these contexts (Medium/Low — later waves)
- maturity #2-5, fleet-rollups #3-6, ci-gate #3-5, investment-simulator #2-5, org-overview #3-6,
  practices #2-5 (Mediums/Lows: doc thresholds, retention-clamp, batch-cap messaging, band-gap, etc.).
