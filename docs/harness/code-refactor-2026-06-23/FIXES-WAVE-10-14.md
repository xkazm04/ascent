# Code Refactor — Fix Waves 10–14 + gap closure: the Medium/Low tail (COMPLETE)

> ~75 commits, the entire actionable Med/Low tail closed. Baseline held throughout:
> tsc 0 · tests 2610 (no net change — these are cosmetic/consolidation, no behavior
> change beyond a few noted drift-corrections). 0 regressions.

After waves 1–9 (all 43 High + 21 Medium), waves 10–14 worked the remaining ~95 Med/Low,
grouped by type and run sequentially (one executor per wave) with a full tsc+suite check
after each.

| Wave | Theme | Closed | Skipped-with-cause |
|---|---|---:|---|
| 10 | Cosmetic cleanup + dead-code Lows + cleanup Mediums | 21 | members #3 (already W2), playbooks #3 (already W9), landing #4 ArchetypeKey (already W1); connect #3 no-op |
| 11 | Structure (Lows + Mediums) | 13 | org-overview #3 (MoversList/MoveRow genuinely differ) |
| 12 | Duplication Lows | 11 | dev-inspector #4 (do-not-consolidate), design-system #3 (DeckNav 2-tone), members #4 (false-positive); ai-native #2 + app-shell #3 already done |
| 13 | Backend/data/scoring duplication Mediums | 15 | pdf-llm #3 already done (W2) |
| 14 | UI duplication Mediums | 14 | — |
| gap | 4 genuinely-missed findings caught in a final audit | 4 | — |

## Gap-closure audit (cross-checked every finding # against fix commits)

A reconciliation of every report finding against the fix-commit `Refs:` trailers surfaced **4 findings that no wave had actually closed** — including one High that had been mis-bucketed. All four fixed:

- **fleet-alerts-digests #1 (HIGH)** — `172e8ee`. The noise-filtered regressers were computed twice in the digest route (signal-gate count + rendered list); the code's own ALERTS #1 comments warned they must stay in lockstep. Hoisted into one `regressersBeyondNoise`.
- **maturity-model-scoring-engine #3 (Med)** — `2d3cca3`. ADR detection regex single-sourced (`ADR_PATH`/`ADR_HINT`) across the D5 + D8 detectors.
- **checkout-plans-polar #3 (Low)** — `4529530`. One `orgUrl(status)` builder for the success+error post-payment redirects.
- **practices-governance-adoption #4 (Low)** — `9c64025`. Trimmed `PracticeApply`'s local `Artifact` to the two fields it reads.

## Notable drift-corrections in the tail

- score-charts #1 — routed the 3 inline `0..100→px` closures through the shared `vScale`/guarded scale, **restoring the `Number.isFinite` NaN-guard** two radial copies had dropped.
- trends #2 — unified `optionLabel`/`scanCaption` (the picker had drifted to append `· latest`); one builder with a flag.
- members-access #4 was investigated and **left as-is**: the client `AcceptResult` is genuinely broader than the server type (carries route-guard `reason`/`error`), so the report's "identical" premise was false.

## Final disposition — 155 / 159 closed

| Severity | Closed | Total |
|---|---:|---:|
| Critical | 0 | 0 |
| High | **43** | 43 |
| Medium | **63** | 63 |
| Low | **49** | 53 |

**4 open — all Low, all won't-fix with documented cause:**
1. `dev-inspector #4` — `splitLoc`/loader path-tail slicing spans the build/runtime layer boundary; the report itself says do NOT consolidate.
2. `design-system #3` — `DeckNav`'s per-state accent/slate color toggle can't route through the 2-tone `Kicker` without a visible change.
3. `members-access-control #4` — the client `AcceptResult` is deliberately broader than the canonical type (false-positive).
4. `org-overview-standing #3` — `MoversList` (overview) and `MoveRow` (executive) use different level-pair guards; sharing would change the executive render.
