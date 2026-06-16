# Bug-UI Fix Wave 6 — Scoring & Gate Correctness

> 4 atomic commits, 6 findings closed (1 critical, 4 high, 1 medium) — **closes the 7th and final critical.**
> Baseline preserved: `tsc` 0 → 0 errors · tests 482/482 → 488/488 (+6 gate regression tests).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `c2c95ef` fix(api/gate): probe only the requested mode's cache key | ci-gate #1 | **Critical** | `gate/[owner]/[repo]/route.ts` |
| 2 | `c48f4bd` fix(scoring/gate): positive security floor + fail-closed dimensions | ci-gate #2, #3 | 2×High | `scoring/gate.ts` (+test) |
| 3 | `52d1399` fix(scoring/gate-comment): optional-chain gaps + escape labels | ci-gate #4, #5 | High + Medium | `scoring/gate-comment.ts` (+test) |
| 4 | `6b1c406` fix(api/simulate): reject NaN / out-of-range targets | simulator #1 | High | `org/simulate/route.ts` |

## What was fixed

1. **Flaky CI gate from a cross-mode cache read (CRITICAL — the 7th).** The gate read `cacheGet(llmKey) ?? cacheGet(mockKey)`, probing the LLM entry first regardless of the requested mode — so a default deterministic (`mock=true`) gate could return a *stochastic* LLM verdict whenever a prior `?mock=0` scan had populated the cache, while the write went to the correct key. A PR could flip pass↔fail between two runs with identical code. Now reads **and** writes the same key (`useLLM = !mock`) — deterministic and reproducible.
2. **Empty/zero security floor silently disabled the gate (High).** `?min_security=` and `?min_security=0` both parsed to a finite 0, read as "floor requested, floor=0" — an always-pass gate that still *looked* like a security gate. A floor is now only requested when `> 0`.
3. **Unscored dimension slipped every floor (High).** `score < min` evaluates `NaN < 40`/`undefined < 40` to `false`, so an unscored dimension passed — the exact Security/Testing dimension a gate enforces could be bypassed by *absence of data*. A new `belowFloor()` fails closed on a non-finite score in both `evaluateGate` and `evaluateGateLite`.
4. **Gate comment crashed on a missing `gaps` array (High).** On a *failing* gate the per-dim table read `d.gaps[0]`, throwing when a report omitted `gaps` — killing the whole check-run + sticky-comment write precisely when the merge-blocking signal matters most. Now optional-chained.
5. **Unescaped labels in the gate comment (Medium).** Dimension names / failure messages / provider label reached rendered markdown unescaped — a `|` broke the table and a literal `<!--` could forge the `GATE_COMMENT_MARKER` and confuse the comment-upsert matcher. `mdCell`/`mdInline` helpers now escape pipes/newlines + defuse the marker.
6. **Simulator accepted `NaN` targets (High).** `typeof NaN === "number"`, so `{ target: NaN }` passed validation; `clamp(Math.round(NaN)) = NaN` then made every `cur < NaN` false → a silent 200 with `before === after`. Both the rank target and each fix leg now require a finite number in 0..100.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 482/482 | 488/488 |
| New tests | — | +6 (security floor, NaN fail-closed, gate-comment crash + escaping) |

## Patterns established (catalogue items 16–17)

16. **A "serve whatever we have" fallback breaks a determinism contract.** When a surface promises a specific mode (deterministic gate, a pinned snapshot), read the key for *that* mode only — don't fall back to a different-mode cache entry, or the result becomes non-deterministic and mode-confused. Reads and writes must use the same key.
17. **Trust boundaries must reject non-finite numbers explicitly.** `typeof NaN === "number"` and `NaN < x === false` mean a missing/NaN value sails through a `typeof` check and *passes* every `<` floor. Validate `Number.isFinite(x)` (and range) at the boundary; treat non-finite as a failure (fail-closed) in any gate.

## Deferred this wave (with rationale)

- **Dimension absent from the archetype lens vanishes from the headline mean (maturity #2, High).** The fix changes the core scoring renormalization (`overallScoreFor`), which would shift production scores and is pinned by engine tests; the report itself calls it "latent" and "documented as a feature in `projectedGain`." That's a **scoring-semantics decision**, not a safe mechanical fix. **→ needs a deliberate scoring-model call.**

## What remains

Remaining waves per INDEX: W7 dates/timezone · W8 file-gen/XSS (badge `data:svg`, PDF 500s) · W9 GitHub resilience · W10 a11y · W11 UI polish. Plus the deferred scoring-semantics item.
