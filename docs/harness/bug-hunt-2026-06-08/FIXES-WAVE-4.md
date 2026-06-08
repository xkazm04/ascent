# Bug Hunter Fix Wave 4 — Scoring correctness

> 4 commits, 5 findings closed (1 Critical + 2 High + 1 Medium + 1 Low); 2 Medium deferred with cause.
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green.
> Branch: `vibeman/bug-hunt-wave1-authz` (continued).

Shared model: the headline score and every projection off it must be **one weighted-mean over present dimensions**, honest about what was actually measured / AI-assessed.

## Commits

| # | Commit | Findings | Severity | Files |
|---|---|---|---|---|
| 1 | `f5b6144` | maturity #2, #3 | High ×2 | `scoring/engine.ts` |
| 2 | `a70c47e` | maturity #1 | Critical | `scoring/engine.ts` |
| 3 | `ca5daf3` | maturity #4 | Medium | `types.ts`, `analyze/index.ts`, `scoring/engine.ts` |
| 4 | `8facbdb` | maturity #7 | Low | `scoring/recommendations.ts` |

## What was fixed

1. **Partial LLM coverage now warns (maturity #1, Critical)** — `isAssessmentUsable` passes any assessment scoring ≥50% of dimensions and never checks *which*, so a model could score only the dims a repo is strong in and omit the weak ones; the omitted dims fell back to their signal floor while present dims blended up, with **no warning** (scan.ts's catch only fires on a throw) — a partial, favorable-looking assessment rendered as a fully AI-validated overall. **Fix:** track un-assessed dims and push a `report.warnings` entry naming them ("AI assessed N of M dimensions; D3, D4 reflect detected signals only — the overall is not fully AI-validated"). Removes the silent false confidence; blend unchanged; mock/full-coverage paths unaffected.

2. **`projectScore` single-sourced (maturity #2, High)** — it re-implemented the weighted mean over `Σ d.weight` (`lensW[id] ?? def.weight`) while the headline uses `overallScoreFor` (`lensW[id] ?? 0`); for a lens-missing id the denominators diverged, so `projectScore(report, {}) ≠ report.overallScore` (broke the Sandbox baseline invariant, skewed `deltaScore`). **Fix:** `projectScore` now reuses `overallScoreFor` — one weighted-mean, one weight source.

3. **True level reachability (maturity #3, High)** — `cheapestPathToNextLevel` inferred reachability from a greedy projection, so headroom trapped in a zero-weight dimension (upside 0) or a rounding shortfall reported `reachable:false` even when closing every gap would cross — or implied a path that doesn't cross. **Fix:** first project ALL dims to 100 (the true ceiling); `< floor` ⇒ genuinely unreachable (clean `reachable:false`), otherwise the greedy steps are guaranteed to cross.

4. **Failed detector no longer deflates the score (maturity #4, Medium)** — a thrown detector emitted a placeholder `signalScore:0` that the engine folded into the mean as a real 0, dragging the overall/level down for an *extraction* failure. **Fix:** a typed `DimensionSignals.failed` flag (set in the detector catch); the engine drops a failed dim (like a dropped/unknown dim — `overallScoreFor` renormalizes over present dims) and warns. *(The mock's strength-label heuristic listing the failure as a "strength" is a separate keyless-demo cosmetic — deferred.)*

5. **`levelUnlock` from canonical ordering (maturity #7, Low)** — the fallback roadmap built `${id}->L${Number(id.slice(1))+1}`, yielding "L5->L5" at the top band and "...->LNaN" on a drifted id. **Fix:** derive the next level via the `LEVELS` index and omit `levelUnlock` at the top band.

## Deferred (with cause)

- **maturity #5 (Medium) — PR/governance double-count vs guardband.** PR/governance evidence is folded into `signalScore`, fed to the LLM as the calibration anchor, *and* used as the guardband center — so the same evidence shapes the score thrice and the auditor can't discount an inflated review rate by >±25. The fix (separate capped addend, or guardband against the pre-fold signal) **changes the deterministic baseline calibration is tuned against** — it needs `npm run bench` / the maturity gate to confirm no regression, which can't be run meaningfully here. **Deferred** as calibration-gated.
- **maturity #6 (Medium) — recommendation PATCH last-writer-wins.** `updateRecommendation` is a read-then-write with no concurrency guard, so concurrent PATCHes can clobber a field and misattribute a timeline `from`. The robust fix is a version-conditional update (client sends last-seen version, 409 on mismatch) — an API contract change; a lighter server-side option (move the `findUnique` into the `$transaction` + `withRetry` so DSQL OCC serializes) only helps on the DSQL target and is unverifiable DB-less. **Deferred** pending a live DB.

## Verification

| Check | Baseline | After Wave 4 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched) | clean |
| `next build` | pass | pass |
| Calibration bench | — | not run (would need representative repos + the bench harness) |

## Cumulative status (waves 1–4)

- **19 findings closed** in 15 fix commits; 1 reassessed (github-app #2); deferred-with-cause: #3-prevention, persistence #4/#5, the read-path withDb migration, maturity #5/#6.
- **Criticals: 7 of 9 closed** (github-app #1, org-dashboard #1, org-scanning #1, usage #1, persistence #1, persistence #2, maturity #1). **1 critical remains:** llm #1 (Wave 5 — quadratic JSON-parse event-loop stall).
- Remaining per INDEX: Wave 5 (lifecycle/crashes — the last critical + claude-cli EPIPE/arg-injection, SSE no-cancel, /api/history validation, NaN chart geometry), Waves 6–8 (billing, cache/sync, session/UI tail).

## Patterns established (catalogue items 10–12)

10. **One roll-up, one weight source.** Two implementations of "the overall score" (headline vs projection) drift the moment a weight source or null-fallback differs (`?? def.weight` vs `?? 0`). Route every projection through the single canonical mean.
11. **"Couldn't measure" ≠ "measured zero."** A failed detector / missing LLM dim must be *excluded + flagged*, never folded in as a real 0 (deflates) or silently floored (false confidence). Renormalize over what was actually measured and say what wasn't.
12. **A coverage gate that counts but doesn't check *what* is gameable.** A ≥50%-of-dimensions gate lets a model cherry-pick the favorable half. Count *and* (ideally) require spread across axes — and at minimum, surface partial coverage so downstream can't read it as complete.
