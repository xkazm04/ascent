# Test Mastery Fix Wave 4 — Score / verdict integrity math

> 7 atomic fix commits, **8 critical findings closed** (cumulative **35 / 60**).
> Suite: **723 → 833 tests (+110), 0 failures.** Baseline preserved: tsc 0 source errors, **0 production source changed**.
> All pure-function tests (LLM-batchable, lowest risk).

## Commits

| Commit | Test file(s) | Findings closed | Sev |
|---|---|---|---|
| `83c8c99` | `src/lib/scoring/gate.test.ts` (+16) | ci-gate `sanitizeGatePolicy` | 1C |
| `dc83316` | `src/lib/scoring/engine.test.ts` (+15) | maturity #1 blend, #2 failed-detector | 2C |
| `8e5ea3a` | `src/lib/maturity/model.test.ts` (+16), `src/lib/ui.test.ts` (+9) | score-charts `levelForScore`/`scoreHex` | 1C |
| `53247e0` | `src/lib/db/org-rollup.test.ts` (+12) | org-overview `computeWindowDeltas` | 1C |
| `0b0e3f2` | `src/lib/org/briefing.test.ts` (+25) | executive-briefing `buildExecBriefing` | 1C |
| `c0c511c` | `src/lib/maturity/forecast.test.ts` (+10) | goals #1 `projectGoal` | 1C |
| `bd7746b` | `src/lib/scoring/orgsim.test.ts` (+6) | investment-simulator `axisScore` | 1C |

## What was fixed (the invariant each test now pins)

1. **`sanitizeGatePolicy`.** Non-object/empty/all-invalid → `null`; scores clamp 0–100 (out-of-range/NaN dropped, not clamped to a boundary); `D1..D9` key allowlist + posture allowlist. The `minDimension:0` **always-pass trap** is pinned-and-flagged.
2. **`assembleReport`.** The coverage-weighted blend `0.6·clamp(coverage)` actually runs (coverage ≠ 1 fixtures); NaN/Infinity coverage → no NaN overall; the ±25 LLM guardband clamps a wild model score; a `failed` detector is excluded via renormalization (not a fake 0); all-failed → INCOMPLETE "not a genuine L1."
3. **`levelForScore` + `scoreHex`/`scoreGlyph`.** Every band cut both sides (24/25, 44/45, 64/65, 84/85), the rounding seam, clamps, and a **property loop** locking `scoreHex(s) === LEVEL_HEX[levelForScore(s)]` so the color ramp can't drift from the rubric.
4. **`computeWindowDeltas`.** A both-windows repo contributes its real delta; an **after-only (onboarded) repo is excluded** (no phantom ~25pt slip/climb); empty/equal windows → null/0, no NaN.
5. **`buildExecBriefing`.** Period delta = current − baseline (missing baseline → null); the prior period is the equal-length preceding window with capped per-dim deltas; strengths/risks selection; null/empty fleet → null briefing. The sparse-fleet strength/risk **overlap** is pinned-and-flagged (KNOWN ISSUE).
6. **`projectGoal`.** reached/tracking/on-pace/behind on both sides of the deadline threshold; a flat or falling pace → behind with null ETA (no false on-pace); exact ETA/required-rate math.
7. **`orgsim` axisScore.** A partially-scanned repo has `overall=80` but `adoption=35`/`rigor=18` (absent dims charged at 0 full-weight) and a flipped posture — pinned-and-flagged as a KNOWN BUG, with a control all-dims case proving the correct path.

## Verification

| | After Wave 3 | After Wave 4 |
|---|---|---|
| Test files | 72 | 75 (+3 new, 5 extended) |
| Tests passing | 723 / 723 | **833 / 833** |
| tsc source errors | 0 | **0** |
| Production source files changed | 0 | **0** |

## Cumulative status

| Wave | Theme | Criticals closed |
|---|---|---:|
| 1 | Cross-tenant auth & IDOR | 11 |
| 2 | Money: charge / refund / reserve / dedup | 9 |
| 3 | Destructive writes & audit atomicity | 7 |
| 4 | Score / verdict integrity math | 8 |
| **Total** | | **35 / 60** |

## Three documented bugs (pinned, not fixed — per the no-source-change rule)

1. **`minDimension:0` always-pass trap** (`gate.ts`) — a `0` floor passes any dimension; `policyFromParams` requires `>0` but `sanitizeGatePolicy` doesn't.
2. **Briefing strength/risk overlap** (`briefing.ts`) — on a sparse fleet (≤5 dims) the same dimension appears as both a top strength and a top risk; no de-dup.
3. **orgsim axisScore absent-dim deflation** (`model.ts` axisScore) — absent dimensions are charged at 0 full-weight (not renormalized like `overall`), deflating the axis and flipping posture for partially-scanned repos.

Each is now caught by a test labeled KNOWN BUG/ISSUE, so a future fix is a deliberate, test-visible change rather than a silent one.

## Patterns established (catalogue items 19–23)

19. **Boundary-both-sides + property-loop for banded functions.** Test both sides of every cut AND a property loop over the full domain locking a derived mapping (color === band) so two rubrics can't drift apart. *(levelForScore/scoreHex)*
20. **Blend with non-default weights.** When a "blank"/default fixture hardcodes the weight to a no-op (coverage:1), the blend never runs — feed non-default weights to exercise the formula + its NaN guard. *(assembleReport)*
21. **Cohort-exclusion assertion.** For windowed deltas, assert that an entity present in only one window is EXCLUDED (so onboarding/churn can't fabricate movement), not just that the matched-cohort delta is right. *(computeWindowDeltas)*
22. **Verdict-ladder both-sides-of-threshold.** For a classifier, test the exact threshold (== boundary) and one step either side, and assert the failure direction (flat/falling → behind) so a false positive is impossible. *(projectGoal)*
23. **Pin-known-bug-with-control.** Pin the buggy numbers labeled KNOWN BUG AND add a control case showing the correct path — a future fix breaks the bug test deliberately while the control stays green. *(orgsim, briefing, gate)*

## What remains

Themes E–G + the 76 Highs, and a tail of Theme A/B criticals not yet closed. Two tracks:
- **Server-side, pure tests (no source changes):** badge private-repo disclosure, `/api/recommendations` IDOR, `ensureOrgId` tenant-resolution, `live-share` HMAC token, `/api/org/members` route gate, `/api/org/export` PII gate, `parseRepoUrl` SSRF, `parseScanReport` failure matrix, `/api/health` leak, `app.ts` token-mint, `listGoals`/`plan.ts`, `getPlaybookAdoption` lift, `scan.ts` usage capture.
- **Frontend (needs pure-logic EXTRACTION from React components → touches source):** `mergeStars`, optimistic watch/schedule rollback, mock-vs-real money gate, SSE import parser.
