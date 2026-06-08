# UI Perfectionist Fix Wave 4 — Component extraction & DRY

> 7 commits, 7 findings closed (1 High a11y + 6 Medium). Closes the scan — 45/45.
> Baseline preserved: tsc 0 → 0 errors · lint 0 errors/6 warnings → 0 errors/6 warnings · `next build` ✓ compiles.

Mental model: extract the shared primitive and route duplicated markup through it, so the chrome
lives in one place and stops drifting. Extend a primitive rather than fork it.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `87b1e67` | report-trends #3 — shared `LevelBadge` | Medium | `LevelBadge.tsx` (new), `ReportView.tsx`, `trends/page.tsx` |
| 2 | `264c702` | org-dashboard #7 — `AiBar` color prop | Medium | `contributors/page.tsx` |
| 3 | `6cf2f03` | org-dashboard #5 — heatmap table a11y | High | `repositories/page.tsx` |
| 4 | `d65f38f` | scan-pipeline #5 — `Panel` primitive | Medium | `page.tsx` |
| 5 | `64125c0` | usage #5 — usage card chrome | Medium | `usage/page.tsx` |
| 6 | `082b82a` | org-dashboard #4 — inset sub-card radius | Medium | `org/[slug]/page.tsx` |
| 7 | `96b4445` | report-trends #4 — shared `ReportShell` | Medium | `ReportShell.tsx` (new), `report/page.tsx`, `trends/page.tsx` |

## What was fixed

1. **`LevelBadge`** extracted — the report headline and trends header each hand-built a level pill, and the trends one had dropped the `LEVEL_GLYPH` (a CVD regression) and used a different separator. Both now route through one badge that always carries the glyph.
2. **`AiBar`** gained an optional `color` prop, so the concentration table's warn-threshold cell routes through it instead of a re-inlined `Meter`+label copy.
3. **Heatmap table a11y** — dimension headers are `<th scope="col">` and repo names are `<th scope="row">`, so each heat-cell number is announced with its row/column headers (was a grid of context-free numbers).
4. **`Panel`** extracted on the landing page — the how-it-works and dimensions cards route through one card-chrome wrapper (standardized on p-6, was p-5/p-6 drift).
5. **Usage card chrome** standardized on `rounded-2xl p-6` across the Stat cards and ratio panels, matching the adjacent UsageTrend (was rounded-xl/p-5 drift).
6. **Org inset sub-card radius** unified — the common-gaps items move from `rounded-lg` to `rounded-xl`, matching the recommendation rows and champion cards.
7. **`ReportShell`** extracted — report/page and trends/page route through one SiteHeader/main/SiteFooter frame; its main carries `id="main"`, so the skip link now also covers those two routes.

## Verification table

| Gate | Before (Phase B2) | After Wave 4 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | 0 errors / 6 warnings | 0 errors / 6 warnings |
| `next build` | passes | ✓ compiles |

Each extraction cleaned up its orphaned locals (ReportView/trends `lc` consts and their now-unused
`LEVEL_CLASSES` import) so no dead code or unused-var warnings were introduced.

## Cumulative status — SCAN COMPLETE (45 / 45)

| Wave | Theme | Closed |
|---|---|---|
| 2 | Scoring truth, CVD redundancy & public badge | 7 |
| 1 | Design-token & color-system unification | 6 |
| 3 | Empty / loading / error / done states | 7 |
| 5 | Accessibility: ARIA, keyboard, contrast | 7 |
| 6 | Responsive & mobile layout | 4 |
| 7 | Polish & microcopy | 7 |
| 4 | Component extraction & DRY | 7 |
| **Total** | | **45 / 45** |

## Patterns established (catalogue items 30–33)

30. **Extract the primitive when a recipe is hand-rolled 2+ times** — `Panel`, `LevelBadge`, `ReportShell`, `InlineEmpty`. The duplication is exactly where drift creeps in (padding, a dropped glyph, copy-pasted magic widths).
31. **Extend a primitive, don't fork it** — `AiBar` gained a `color` prop rather than spawning a re-inlined copy; the heatmap row gained `th scope` rather than forking a new table.
32. **A matrix/heatmap table still needs `th scope`** — a grid of numbers is meaningless to a screen reader without row/column header associations, even when it looks self-evident visually.
33. **Consolidation can carry a free win** — `ReportShell`'s shared `<main>` picked up `id="main"`, extending skip-link coverage to two more routes as a side effect of the extraction.

## New primitives this wave

- `src/components/LevelBadge.tsx` — the canonical maturity-level pill (glyph + id + name).
- `src/components/report/ReportShell.tsx` — the report/trends page frame (header + main#main + footer).
- `Panel` (local to `page.tsx`) and `InlineEmpty` (`org/ui.tsx`, added in Wave 3) round out the
  extracted set.
