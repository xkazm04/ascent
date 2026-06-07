# UI Perfectionist Fix Wave 7 — Trends/report finishing & a11y

> 4 commits, 4 findings closed (2 medium · 2 low).
> Baseline preserved: tsc 0→0 errors · eslint 0 err/3 warn → 0 err/3 warn · `next build` passes.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `82728c4` | RT#4 | medium | `src/app/trends/loading.tsx` (new) |
| 2 | `e66ec70` | RT#5 | medium | `src/components/report/DimensionTrends.tsx` |
| 3 | `8297cbd` | RT#8 | low | `src/components/report/Charts.tsx` |
| 4 | `bc1b1be` | CO#7 | low | `src/components/onboarding/OnboardingFlow.tsx` |

## What was fixed

1. **/trends loading skeleton (RT#4).** The `/trends` server component awaited the repo's scan history with no loading UI, flashing a blank screen before first paint — unlike `/report`'s skeleton. Added an App Router `loading.tsx` that mirrors the page silhouette (title + overall-chart + dimension-grid placeholders).
2. **Descriptive per-chart aria labels (RT#5).** The nine small-multiple charts shared one static `aria-label="Dimension trend"`, so a screen reader announced nine identical labels. `DimLine` now takes the dimension name + current score and emits e.g. *"Testing score trend, currently 62 of 100."*
3. **Responsive maturity radar (RT#8).** `RadarChart` was a fixed 340px square that could overflow and clip its axis labels on ~320–360px phones. It now fills its container (`w-full`, `h-auto`) capped at `max-w-[340px]`, keeping the fixed `viewBox` for the internal geometry. The pointer-hover math already normalizes via `getBoundingClientRect`, so hover still works at any rendered size.
4. **Surfaced scan-progress % (CO#7).** The onboarding scan phase computed `pct` (and fed it to the progressbar's `aria-valuenow`) but only showed sighted users a raw `completed/total` fraction. The label now leads with the percentage (e.g. *"40% · 4/10"*).

## Verification (before / after)

| Gate | Before (baseline) | After Wave 7 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` | 0 errors, 3 warnings | 0 errors, 3 warnings (same pre-existing) |
| `next build` | ✅ pass | ✅ pass (`/trends/loading` registered) |

## Cumulative status (all waves)

| Wave | Theme | Closed | Cumulative |
|---|---|---:|---:|
| 1 | Design-token unification | 7 | 7 / 40 |
| 2 | Notice / EmptyState consolidation | 5 | 12 / 40 |
| 3 | Chart & badge data-viz language | 7 | 19 / 40 |
| 4 | Cross-page funnel & dashboard layout | 4 | 23 / 40 |
| 5 | Tabular rows: extract + readable + focusable | 5 | 28 / 40 |
| 6 | Landing cohesion & correctness | 4 | 32 / 40 |
| 7 | Trends/report finishing & a11y | 4 | 36 / 40 |

**36 / 40 closed.** Remaining 4: carried **OD#4** + **OD#7** (org-tab shell pass — subjective multi-tab layout, wants visual validation), deferred **UB#6** (blocked on a docs route), skipped **SP#7** (would clutter the marketing hero).

## Pattern established (catalogue item 16)

16. **Match the loading affordance to its siblings** — if one route streams a skeleton (`/report`) while a sibling doing comparable server work shows nothing (`/trends`), add the missing loading UI. Consistency of *perceived* performance is part of the design language, not an afterthought.

## What remains (handoff)

- **OD#4, OD#7** — best done together as a small "org-tab shell" pass: a shared `TabHeader` (consistent SegmentSelector placement) + a section-spacing convention across the ~7–11 org tabs. Do it with the dev server up for visual diffing.
- **UB#6** — revisit if/when a usage-docs page exists; the `Stat`/`Bar` dedup is purely local cosmetic.
- **SP#7** — intentionally not actioned (silent omission of the empty gallery is correct UX).
