# UI Perfectionist Fix Wave 3 — Chart & badge data-viz language

> 5 commits, 7 findings closed (4 high · 3 medium).
> Baseline preserved: tsc 0→0 errors · eslint 0 err/3 warn → 0 err/3 warn · `next build` passes.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `052ee3b` | RT#2, RT#6 | high, medium | `src/components/report/TrendChart.tsx` |
| 2 | `ba27c22` | RT#1 | high | `src/components/report/DimensionTrends.tsx` |
| 3 | `a2482f7` | RT#7 | medium | `src/components/report/ReportView.tsx` |
| 4 | `598b216` | UB#1, UB#2 | high, high | `src/app/api/badge/[owner]/[repo]/route.ts` |
| 5 | `caaf979` | UB#5 | medium | `src/app/usage/page.tsx` |

## What was fixed

The product's core output is data viz, but its charts and badge spoke several visual dialects. Wave 3 makes them share one language: the score red→green ramp and the `chartScale` bands.

1. **Overall trend line follows the score (RT#2).** `TrendChart` hardcoded its line accent-blue while `DimLine`/`Sparkline` use `scoreHex(last)` — an L1-red repo showed a confident blue trajectory. The line now strokes with the latest score's color too.
2. **Sparkline reference line snaps to a real edge (RT#6).** The lone midline at an arbitrary `50` moves to `65` (the L4 "Advanced" band edge from `chartScale.BAND_EDGES`), so it marks a meaningful threshold instead of a non-boundary.
3. **Per-dimension charts get the same bands (RT#1).** `DimLine` drew bare dashed gridlines at a hardcoded `[25,45,65,85]` with no shaded strata — a different frame from the overall chart. It now renders the same `LEVEL_BANDS`, with interior gridlines derived from `BAND_EDGES`. (The card header already shows the numeric score, so the small multiples keep a clean axis.)
4. **Score-waterfall slivers stay visible (RT#7).** Low-scoring dimensions collapsed to unhoverable sub-pixel slivers; nonzero segments now carry a small `minWidth`. The itemized list under the track remains the full accessible legend; a bidirectional segment↔row hover link is noted as a future enhancement.
5. **Legible README badge (UB#1, UB#2).** The badge painted value text white over `LEVEL_HEX` fills, but the lighter L3/L4/L5 fills fail behind white (~1.7–2.2:1) — the highest-maturity / gate-pass badges were the illegible ones. The value text now picks white or near-black ink by WCAG contrast against its fill. The text baseline moved from a `+4` constant (tuned for the 28px/12px default) to `h/2 + fontSize/3`, so it stays centered in the 20px `flat-square` style and any future size.
6. **Provider bars differentiated (UB#5).** The "By inference engine" bars were all azure with raw provider ids. A `PROVIDER_META` map gives each provider a human label (Gemini, AWS Bedrock, Claude, Mock) and a distinct color; unknown ids fall back to the accent + verbatim id.

## Verification (before / after)

| Gate | Before (baseline) | After Wave 3 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` | 0 errors, 3 warnings | 0 errors, 3 warnings (same pre-existing) |
| `next build` | ✅ pass | ✅ pass |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Cumulative |
|---|---|---:|---:|
| 1 | Design-token unification | 7 | 7 / 40 |
| 2 | Notice / EmptyState consolidation | 5 | 12 / 40 |
| 3 | Chart & badge data-viz language | 7 | 19 / 40 |

Remaining: **21 findings** across Waves 4–7 (Wave 5 also carries the deferred UB#6).

## Patterns established (catalogue items 8–10)

8. **Single-source the encoding, not just the color** — charts over one domain (maturity score) must share the same *rule* (line color = `scoreHex(last)`; bands = `chartScale.LEVEL_BANDS`), not merely look similar. One chart opting out (a hardcoded blue line, hardcoded gridlines) breaks the visual language even when each chart is internally fine.
9. **Contrast-pick the foreground over a data-driven fill** — when text sits on a fill whose color varies with data (level hex), don't hardcode white; compute WCAG contrast and choose white vs ink. The "white-on-color" convention is exactly what produces the illegible cases.
10. **Derive SVG geometry from its inputs, not a default** — a baseline/offset tuned for one height/font (the `+4` magic constant) silently breaks at other sizes. Express it as a function of `h`/`fontSize` so new styles and sizes stay correct by construction.

## What remains

- **Wave 4** — Cross-page funnel & dashboard layout (CO#1, CO#2, CO#6, OD#3, OD#4, OD#7).
- **Wave 5** — Tabular rows: extract + readable + focusable (OD#1, OD#6, OD#8, CO#5, CO#4) + deferred UB#6.
- **Waves 6–7** — Landing cohesion & correctness; trends/report finishing & a11y. See `INDEX.md`.
