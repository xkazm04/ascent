# UI Perfectionist Fix Wave 4 — Cross-page funnel & dashboard layout

> 2 commits, 4 findings closed (2 high · 2 medium). 2 findings deferred (see below).
> Baseline preserved: tsc 0→0 errors · eslint 0 err/3 warn → 0 err/3 warn · `next build` passes.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `2a02276` | CO#1, CO#2, CO#6 | high, high, medium | `src/app/connect/page.tsx` |
| 2 | `8c0882c` | OD#3 | medium | `org/ui.tsx`, `org/[slug]/page.tsx`, `…/contributors/page.tsx`, `…/delivery/page.tsx` |

## What was fixed

1. **Connect ↔ onboarding feel like one funnel (CO#1, CO#2, CO#6).** `/onboarding` had a progress checklist, a `text-3xl` title and `rounded-2xl` panels; `/connect` had no progress cue, a `text-2xl` title and `rounded-xl` panels. Connect now:
   - renders the same `OnboardingChecklist` (install → pick repos → scan; install state derived from the session) so the first-run path is legible (CO#1),
   - uses the `text-3xl` title scale (CO#2),
   - uses the canonical `rounded-2xl` panel radius (CO#6).
2. **One tile-grid rhythm across org tabs (OD#3).** Summary-tile rows drifted (delivery `gap-3` vs overview/contributors `gap-4`). Added a shared `TILE_GRID` constant (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`) used by overview + contributors, and aligned delivery's content-specific grids to `gap-4`. Column counts that vary for content reasons (delivery's 6 PR metrics) are intentionally left.

## What was deferred (and why)

Both are medium and genuinely benefit from visual validation across many tab files; doing them blind risks regressions a type/build gate can't catch.

- **OD#4 — SegmentSelector placement.** The selector is already right-aligned in both places it appears (overview controls row + contributors header), but fully unifying its position needs a shared org-tab-header component applied across the tabs. Best done as a focused pass with the app running.
- **OD#7 — section vertical rhythm.** Top-level section spacing drifts (overview `space-y-6`, delivery `space-y-8`, contributors per-section `mt-8`). Standardizing on one convention touches ~7–11 tab pages and changes structural spacing; it wants a visual check to avoid subtly breaking each tab's first-element spacing.

→ Recommend completing OD#4 + OD#7 together as a small "org-tab shell" pass (shared `TabHeader` + section-spacing convention), ideally with the dev server up for visual diffing.

## Verification (before / after)

| Gate | Before (baseline) | After Wave 4 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` | 0 errors, 3 warnings | 0 errors, 3 warnings (same pre-existing) |
| `next build` | ✅ pass | ✅ pass (connect's client OnboardingChecklist island resolved) |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Cumulative |
|---|---|---:|---:|
| 1 | Design-token unification | 7 | 7 / 40 |
| 2 | Notice / EmptyState consolidation | 5 | 12 / 40 |
| 3 | Chart & badge data-viz language | 7 | 19 / 40 |
| 4 | Cross-page funnel & dashboard layout | 4 | 23 / 40 |

Remaining: **17 findings** — Wave 5 (OD#1, OD#6, OD#8, CO#5, CO#4 + deferred UB#6), Wave 6 (landing), Wave 7 (trends/a11y), plus the deferred OD#4 + OD#7.

## Patterns established (catalogue items 11–12)

11. **One funnel, one chrome** — parallel entry pages of the same flow (connect/onboarding) must share title scale, panel radius, and a progress cue. Reuse the existing progress component rather than leaving one half bare.
12. **Single-source the grid, not just the values** — a shared `TILE_GRID` constant keeps every tab's tile rhythm in lockstep. Content-specific column counts may vary, but the gap/rhythm should not drift.

## What remains

- **Wave 5** — Tabular rows: extract a shared `OrgTable` (OD#1), heatmap-numeral contrast (OD#6), row hover + focus rings (OD#8, CO#4), declutter repo-row CTA (CO#5) + deferred UB#6.
- **Wave 6** — Landing cohesion & correctness (SP#1, SP#5, SP#6, SP#7, SP#8).
- **Wave 7** — Trends/report finishing & a11y (RT#4, RT#5, RT#8, CO#7).
- **Carried** — OD#4, OD#7 (org-tab shell pass).
