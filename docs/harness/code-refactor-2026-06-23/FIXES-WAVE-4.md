# Code Refactor — Fix Wave 4: Scoring / domain logic (COMPLETE)

> 5 commits, 5 High findings closed. Baseline: tsc 0→0 · tests 2610 (unchanged —
> pure dedup, **no test assertion touched**; gate 63 + scoring 137 pass identical).

| # | Commit | Finding | What was consolidated |
|---|---|---|---|
| 1 | `refactor(scoring): single-source the gate failure rules behind one normalized evaluator` (`64d1a46`) | ci-gate #1 | Extracted `evaluateNormalized` over a shape-neutral view; `evaluateGate` (ScanReport) + `evaluateGateLite` (GateSnapshot) adapt their input and call it. Exact signatures/returns/messages preserved. |
| 2 | `refactor(maturity): add levelIndex/nextLevel helpers …` (`c827daa`) | maturity-scoring #1 | `levelIndex`/`nextLevel` in `model.ts`; routed the 4 ladder sites (`projectScore`, `projectedGain`, `cheapestPathToNextLevel`, `buildFallbackRoadmap`) through them. |
| 3 | `refactor(maturity): single-source the dimension-id guard as isDimensionId` (`f55a81f`) | playbooks #1 | One `isDimensionId(v): v is DimensionId` in `model.ts`; replaced the four `/^D[1-9]$/` route validators (playbooks routes gain narrowing). |
| 4 | `refactor(practices): extract the per-repo apply-PR pipeline …` (`0e9f019`) | practices-governance #1 | `applyPracticeToRepo` in `src/lib/practices/apply.ts`; both `apply` + `apply-batch` routes call it, the `batch` flag threaded as a param. |
| 5 | `refactor(governance): single-source the CI action YAML preamble via ciActionYaml` (`c128480`) | practices-governance #2 | `ciActionYaml` exported from `governance.ts`; the page and `governanceMarkdown` both build from it (byte-identical). |

## Notes (behavior-identity preserved)

- **Gate (#1)**: the governance message string is now built eagerly in the adapter but still only *emitted* under the readable-gated enforce flag — the `"undefined"` branch can never surface, output unchanged.
- **#2**: the always-valid `toIdx` lookups use `levelIndex` too (clamp is a no-op there); `LEVELS` import dropped from both scoring files.
- **#4**: extracted to a *separate module* so the route tests' transitive mocks still intercept; the single route computes `orgId` before the call (harmless, `.catch(()=>null)`-guarded).

## Pattern established (catalogue item 8)

8. **Twin functions over different shapes** — two functions (`evaluateGate`/`evaluateGateLite`) run the *same rules* over different field shapes and stay in sync only by manual edit. Consolidate by defining one evaluator over a **normalized view** and giving each public entry point a thin adapter — the signatures stay, the rules live once. Prove identity by running the existing test suites unchanged.
