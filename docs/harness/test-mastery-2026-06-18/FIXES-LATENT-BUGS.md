# Test Mastery — ascent — Latent-bug fix pass

> The 9 latent bugs that the test waves **pinned as KNOWN current behavior** are now **fixed**.
> Each fix changes production source AND flips the test that documented the bug to instead enforce the corrected behavior.
> 10 atomic `fix(...)` commits (9 bugs + 1 shared CSV helper). Suite stayed green (1728), tsc 0, 0 regressions.

## The 9 fixes

| # | Bug | Fix | Commit |
|---|---|---|---|
| 1 | gate `minDimension:0` always-pass | `sanitizeGatePolicy` drops a `<=0` floor (key absent), matching `policyFromParams`'s `>0` rule | `beaf549` |
| 2 | briefing strength/risk overlap | risks built from sorted dims **minus** the chosen strengths → always disjoint | `b9e3767` |
| 3 | orgsim `axisScore` absent-dim deflation | `axisScore` takes an `isPresent` predicate (default no-op) and renormalizes over present dims like `overall`; `recomputeRepo` wires it | `37e2f6d` |
| 4 | `parseRepoUrl` host-suffix (`notgithub.com`) | host check anchored `/github\.com$/` → `/(^|\.)github\.com$/` | `3e8eb47` |
| 5 | `/api/health` no-try/catch leak | handler wrapped in try/catch → generic 503, raw error never in body | `7ee220b` |
| 6 | scan-alerts audit-suppresses-alert | `recordAudit` wrapped in `.catch` so `dispatchAlert` is reached regardless | `3928d79` |
| 7 | movers/rollup baseline asymmetry | `getOrgMovers` baseline flipped to strict `< start`, matching `getOrgRollup`'s half-open window | `98db5b8` |
| 8 | manifest command-quote truncation | doctor `capabilities()` regex matches the full JSON-escaped string + `JSON.parse`s it | `c495511` |
| 9 | `/api/history` CSV formula-injection | `csvField` prefixes a `=`/`+`/`-`/`@` cell with `'` and quotes it | `4562475` |
| 9b | **same gap** in `/api/org/export` PII CSV | identical neutralizer applied to that route's own `csvField` (+ test) | `6849344` |

## User-visible changes (3 of the 9 change displayed numbers)

- **#2 briefing:** on a tiny fleet (≤5 dimensions) a dimension no longer appears as both a top strength and a top risk; very small fleets may now show fewer risks (the strongest dims are claimed by strengths).
- **#3 axisScore:** a **partially-scanned** repo now shows a correct (higher) adoption/rigor axis and posture instead of a deflated one (e.g. a `{D1:80,D2:80}` repo: adoption/rigor 35/18 → **80/80**, posture `early` → `ai-native`). Fully-scanned repos are unchanged (the renormalization is a no-op there).
- **#7 movers/rollup:** the movers panel and the headline period-delta tiles now agree on a boundary scan (one at the exact window start), eliminating the contradictory-movement display.

The other 6 are security/correctness hardening with no intended display change (a public endpoint no longer leaks on throw, a non-github host is rejected, a dropped alert now fires, a CI gate can't be silently disarmed by a 0 floor, a quoted command round-trips, CSV cells can't execute as formulas).

## Method & safety

Two batches: 6 safe/localized fixes in parallel, then the 3 scoring/display fixes (each reported ripples rather than editing files another subagent owned). Each subagent fixed its source + flipped its own KNOWN test; the orchestrator ran the **central** full suite + tsc + `next build` after each batch (the only authoritative check — concurrent per-subagent full-suite runs transiently saw each other's mid-flight edits). The `axisScore` fix deliberately defaulted its new predicate to a no-op so **no other caller's numbers changed** (zero ripples).

**Note (not part of this run):** `next build` currently fails on the user's in-progress landing-prototype work (`src/app/page.tsx` → `LandingPrototypes.tsx` imports `AltimeterVariant`/`FlightDeckVariant`/`IndexVariant`/`BaselineVariant`, which don't exist yet) — unrelated to these fixes, which are verified by tsc 0 + the full vitest suite. That WIP was never touched.

## Status

All 60 criticals + all 76 Highs + all 9 latent bugs closed. Remaining: 40 Mediums + 16 Lows, and the per-area/changed-code CI coverage gate.
