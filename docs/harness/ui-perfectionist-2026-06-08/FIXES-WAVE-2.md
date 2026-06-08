# UI Perfectionist Fix Wave 2 — Scoring truth, CVD redundancy & public badge

> 7 commits, 7 findings closed (the scan's 1 Critical + 4 High + 2 Medium).
> Baseline preserved: tsc 0 → 0 errors · lint 0 errors/6 warnings → 0 errors/6 warnings · `next build` passes.

Mental model: the product's *verdict* must be correct and legible to everyone, everywhere — fix
hardcoded counts, restore the dropped dimension, add color-blind redundancy, and harden the public
badge (including the one Critical).

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `0c31a5a` | scan-pipeline #1 — metadata dimension count | High | `src/app/layout.tsx` |
| 2 | `79d7d14` | org-dashboard #1 — restore D9 Security | High | `src/components/org/ui.tsx`, `…/repositories/page.tsx` |
| 3 | `9f4040c` | onboarding #3 — LEVEL_GLYPH on score chips | High | `OnboardingFlow.tsx`, `InstallationRepos.tsx` |
| 4 | `6b675df` | report-trends #2 — band labels + sr-only table | High | `src/components/report/TrendChart.tsx` |
| 5 | `1fb633e` | usage/badge #1 — dark-README legibility | **Critical** | `src/app/api/badge/[owner]/[repo]/route.ts` |
| 6 | `32c3f53` | usage/badge #3 — CVD glyph | High | `…/badge/[owner]/[repo]/route.ts` |
| 7 | `daf3d2f` | usage/badge #4 — width letter-spacing | Medium | `…/badge/[owner]/[repo]/route.ts` |

> Branch note: `vibeman/ui-perfectionist-wave2` also carries interleaved `feat(...)` commits from a
> concurrent process (autoscan cadence, trajectory forecast, sign-out-everywhere). The 7 `fix(...)`
> commits above are this wave; tsc/lint/build all pass with that concurrent work present.

## What was fixed (grouped by sub-pattern)

### Source-of-truth correctness (was silently drifting)
1. **Metadata dimension count** — the `<head>` description advertised "7 dimensions" while the rubric defines 9 and the hero rendered 9; the share/search snippet contradicted the on-site copy. Now interpolated from `LEVELS.length`/`DIMENSIONS.length`, so it can't desync again.
2. **D9 Security restored to the fleet heatmap** — `DIMS` was frozen at D1–D8, so the repo×dimension heatmap and dimension averages silently omitted Security (the highest-stakes axis for a SaaS audience). `DIMS` is now derived from the canonical `DIMENSION_SHORT` map — the same source that supplies the column labels, so columns and labels can never diverge — and the section copy counts dimensions dynamically.

### Color-blind (CVD) redundancy — hue is never the sole signal
3. **Onboarding + connect score chips** now prepend the `LEVEL_GLYPH` (○◔◑◕●) the codebase mandates everywhere a level color appears — these are the highest-stakes "did my repo pass?" chips and were hue-only.
4. **TrendChart maturity bands** get an L1–L5 label at each band midpoint plus an `sr-only` data table (scan date / score / level) referenced via `aria-describedby`, mirroring the radar chart. The bands feature — invisible to most users and entirely absent for SR users — is now legible.
6. **Public badge** prepends the level glyph to the level value and a ✓/✗ to the gate verdict, so a green L5 vs red L1 (and pass vs fail) survives for the ~8% of men with red-green CVD.

### Public badge hardening (the artifact that advertises the product)
5. **CRITICAL — dark-README legibility.** The `#0f172a` label half sat at ~1.04:1 on GitHub's `#0d1117` dark mode and visually disappeared. A 1px slate-400/40% outline inset 0.5px now gives the badge a visible edge on both white and near-black backdrops.
7. **Width math** now folds `letter-spacing="1"` into the for-the-badge width estimate via a shared `textW()`, so long/glyph-prefixed values ("● L5 Autonomous") can't clip against the fill boundary.

## Verification table

| Gate | Before (Phase B2) | After Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | 0 errors / 6 warnings | 0 errors / 6 warnings |
| `next build` | (not captured) | passes |
| Playwright e2e | not run (needs live server) | not run (needs live server) |

Each fix was type-checked before its commit; the warnings are pre-existing (`InstallationRepos` useMemo deps; root + worktree `vitest.config.js` anon-export) and untouched by this wave.

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---|---|---|
| 2 | Scoring truth, CVD redundancy & public badge | 7 |
| **Total** | | **7 / 45** |

Remaining: **38 findings** across Wave 1 (design-token unification, 6), Wave 3 (states, 7), Wave 4 (extraction/DRY, 7), Wave 5 (a11y ARIA/keyboard/contrast, 7), Wave 6 (responsive, 4), Wave 7 (polish, 7).

## Patterns established (catalogue items 1–5)

1. **Source-of-truth derivation** — UI columns/counts/labels must be derived from the canonical model or map (`Object.keys(MAP)`, `${ARRAY.length}`), never a hand-frozen literal. A frozen literal silently drifts the moment the model grows; it cost a dropped Security dimension and a wrong public dimension count here.
2. **Non-color (CVD) redundancy** — anywhere hue signals a level/score/verdict, pair it with the `LEVEL_GLYPH` / explicit id / ✓✗ mark. Applies equally to in-app chips and *exported* artifacts (the public badge), which are the easiest to forget.
3. **Dual-background artifact legibility** — an SVG embedded in third-party surfaces (READMEs, emails) renders on both light and dark; give it a background-independent hairline border instead of assuming a light page. Verify the design against `#ffffff` and `#0d1117`.
4. **Proportional-font width math** — when sizing a box from character count, include letter-spacing (and ideally per-glyph advances) or left-anchored text clips; a flat avg-char-width underestimates spaced uppercase.
5. **Chart text alternative** — color-encoded chart bands/series need a non-color visible label *and* an `sr-only` data table referenced via `aria-describedby`. Mirror the most-accessible chart already in the codebase (here, the radar's `sr-only` table) so all charts converge on one pattern.

## What remains

Six themed waves are still open per `INDEX.md`. The natural next pick is **Wave 1 (design-token unification, 6 mechanical fixes)** — it shares the "route everything through the canonical token/ramp" model with this wave's color work and is the lowest-risk remaining batch; or **Wave 3 (states)** for the highest user-visible polish gain.
