# Report & visualization

The report surface turns a `ScanReport` into an interactive, auditable narrative: an
overall score ring, the level ladder, the adoption × rigor posture quadrant, a radar +
per-dimension breakdown with inline evidence and **provenance** (signal score → LLM
judgment → blended result), contributor AI attribution, PR signals, and a prioritized
roadmap. With a database, it also shows score history over time, a "what changed" diff
between any two scans, and per-dimension trends.

All charts are **dependency-free inline SVG** — no D3/recharts — to keep the bundle small.

## Pages

| Route | Component | Type | Data source |
| --- | --- | --- | --- |
| `/report` | `src/app/report/page.tsx` | Client-driven | Live scan over `/api/scan/stream`; reads `?repo=` / `?fresh=1`. |
| `/report/[owner]/[repo]` | `src/app/report/[owner]/[repo]/page.tsx` | Hybrid | Server-renders a persisted scan (`getScanReportByCommit`, optional `@sha`); else falls back to a live stream. Shareable permalink. |
| `/report/compare` | `src/app/report/compare/page.tsx` | Server | `getScanComparison()` (needs DB). Picks two scans via `?a=`/`?b=`, renders the diff. |
| `/trends` | `src/app/trends/page.tsx` | Server | `getRepositoryHistory()` (needs DB). All scans for a repo with a range filter. |

## Rendering (`ReportClient` → `ReportView`)

`ReportClient` (`src/components/report/ReportClient.tsx`) drives a **live** scan: it POSTs
`{ url, fresh }` to `/api/scan/stream`, renders a determinate progress UI (provider-aware
headline, stage checklist), then validates the `result` payload with `parseScanReport()`
before handing it to `ReportView`. A malformed scan becomes a clean error, not a render
crash. `ReportErrorBoundary` wraps both for render-time safety, and `onRetest()` re-runs a
fresh scan in place.

`ReportView` (`src/components/report/ReportView.tsx`) renders, in order:

1. **Header** — repo link, language, stars, last push, archetype + AI-usage badges,
   engine (`provider/model` or "Demo · deterministic rubric"), confidence %.
2. **Warnings** — `report.warnings[]` (low coverage, LLM fallback, …).
3. **Score + level** — `ScoreRing`, optional `DeltaPill` ("since last scan"), level badge,
   headline, and the visual `LevelLadder`.
4. **Posture** — two `AxisBar`s (adoption, rigor) + `PostureQuadrant` (with a trail to the
   previous scan).
5. **Maturity over time** — `TrendChart` (level-banded background) of persisted scans.
6. **Strengths / Risks** — two `ListCard`s.
7. **Radar + dimension breakdown** — `RadarChart` plus a `DimensionCard` per dimension:
   score bar, expandable summary, **evidence**, **gaps**, a per-dimension sparkline, and a
   `ProvenanceTrack` (signal vs LLM vs blended, with the ±guardband zone shown).
8. **Contributors** — login + AI-commit ratio bars.
9. **PR signals** — `PrSignalsPanel` (review coverage, merge rate, small-PR rate, time to
   merge / first review, revert rate, tools detected) when `report.prStats.analyzed > 0`.
10. **Next-level path** — fastest dimensions to close, then either `RoadmapSteps` (no DB)
    or the interactive `RecommendationTracker` (DB-backed, see below).
11. **Discrepancies** — claims where the LLM questioned a deterministic signal.
12. **Badge share** — level + gate badges with copy buttons (see [badge.md](badge.md)).

`ReportView` also reconciles the live report against persisted history on mount: it fetches
`/api/history` + `/api/recommendations`, builds the chronological trend points (appending
the current scan if not yet stored), and picks the correct baseline for deltas.

## Charts (`src/components/report/Charts.tsx`, `TrendChart.tsx`, `DimensionTrends.tsx`)

| Component | Renders | Interaction |
| --- | --- | --- |
| `ScoreRing` | Overall score as an SVG progress ring; arc length **and** color encode the score (color-blind-safe). | static |
| `RadarChart` | The dimensions as a radar polygon with 25/50/75/100 rings. | hover snaps to nearest vertex; SR-table fallback |
| `TrendChart` | Overall-score history; background bands shade the 5 levels. | hover crosshair + `PointTooltip` (score, date, engine, delta) |
| `Sparkline` | One dimension's score history inline (132×34). | hover crosshair |
| `PostureQuadrant` | Adoption (x) × rigor (y) plot with a glowing dot + trail to prior scan. | mount animation (respects reduced-motion) |
| `DimLine` | A dimension's trend line; null points render as breaks, never 0-crossings. | hover tooltip |

The hover layer is shared (`src/components/report/chartHover.tsx`: `useChartHover`,
`ChartTooltip`, `PointTooltip`). Color/glyph mapping lives in `src/lib/ui.ts`
(`scoreHex`, `scoreGlyph` — L1 red → L5 green, ○ → ●).

## Comparison (`src/lib/report/compare.ts` + `WhatChanged`)

`diffScans(before, after)` is a pure diff engine returning a `ScanDiff`: overall/adoption/
rigor `AxisDelta`s, a `LevelTransition`, posture change, per-dimension `DimensionDiff[]`,
closed/opened gap counts, appeared/disappeared signal counts, recommendations moved to
done, and human-readable `movements[]` attribution lines sorted by magnitude. Gaps and
evidence are normalized (`norm()`: trim/lowercase/collapse-whitespace) for set comparison;
deltas are `null` unless **both** scans scored the dimension (no invented movement).

`WhatChanged` (`src/components/report/WhatChanged.tsx`, server) renders the diff as a
story — signal-count badges, "why it moved" attribution, level/posture transitions, axis
diff bars, per-dimension `DimensionDiffCard`s, and completed recommendations.
`ScanComparePicker` (client) holds the two-scan selection entirely in the URL
(`?a=&b=`) so the comparison is shareable and back-button-safe.

## Trends / history

- `GET /api/history?repo=owner/repo` → `RepositoryHistory` (repo + `HistoryPoint[]`).
  Requires `DATABASE_URL` (503 otherwise); org-scoped and session-gated when auth is on.
- `DimensionTrends` (`src/components/report/DimensionTrends.tsx`) fetches history and
  renders an overall `TrendChart` plus a small-multiple `DimLine` per dimension, with a
  range toggle (5d / 30d / 90d / all).

## Recommendations UI

Recommendations are persisted per repo (latest scan), each a `PersistedRecommendation`
with a `status` ∈ `open | in_progress | done | dismissed`.

| Route | Method | Behavior |
| --- | --- | --- |
| `/api/recommendations?repo=` | `GET` | `{ scanId, items[] }` for the repo's latest scan (503 without DB). |
| `/api/recommendations/[id]` | `PATCH` | `{ status }` → updated item. Validates against `REC_STATUSES`; 404 if not found, 503 without DB. |

`RecommendationTracker` (inside `ReportView`) shows a progress bar + per-item status
dropdowns with **optimistic updates**, a per-row `savingIds` set (overlapping saves each
disable only their own row), rollback on failure, and an `aria-live` region announcing
each save. When the DB isn't configured it degrades to the read-only `RoadmapSteps`
(sorted impact↑/effort↓, quick wins first).

## Validation (`src/lib/report/validate.ts`)

`parseScanReport()` is a hand-rolled guard (no runtime deps) over exactly the fields
`ReportView` dereferences — repo, level, posture, engine, scores, dimensions
(id/name/score/signalScore/llmScore/weight/evidence/gaps), contributors, roadmap. It
returns `{ ok: true, report }` or `{ ok: false, error }`, catching truncated or
schema-drifted payloads before they can crash a render.

## Key files

| File | Role |
| --- | --- |
| `src/components/report/ReportClient.tsx` | Live-scan orchestration: SSE stream, progress UI, validation. |
| `src/components/report/ReportView.tsx` | The full report render (all sections + trackers/panels). |
| `src/components/report/Charts.tsx` | `ScoreRing`, `RadarChart`, `PostureQuadrant`. |
| `src/components/report/TrendChart.tsx` | Overall trend + `Sparkline`. |
| `src/components/report/DimensionTrends.tsx` | Per-dimension small multiples + range toggle. |
| `src/components/report/WhatChanged.tsx` | Diff story renderer. |
| `src/components/report/ScanComparePicker.tsx` | URL-driven two-scan picker. |
| `src/components/report/deltas.tsx` | `DeltaPill` / `DeltaTag` chips. |
| `src/lib/report/compare.ts` | `diffScans()` pure diff engine. |
| `src/lib/report/validate.ts` | `parseScanReport()` trust-boundary validation. |
| `src/lib/ui.ts` | Color/glyph/format helpers shared across the report. |

## Known gaps

- **No PDF / export** of a single report — reports are shareable only as links.
- **Textual, not semantic, diffing** — `norm()` collapses whitespace/case but won't equate
  reworded evidence ("uses GitHub Actions" vs "GitHub Actions detected").
- **No LLM-reasoning drill-down** — `ProvenanceTrack` shows *that* the LLM adjusted a
  score, not the full rationale beyond the dimension summary.
