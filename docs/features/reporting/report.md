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
| `/trends` | `src/app/trends/page.tsx` | Server | `getRepositoryHistory()` (needs DB), to `HISTORY_SCAN_CAP` — the same depth the CSV export uses. Range-filtered chart, plus an all-time trajectory panel and timeline annotations. |

### Cold permalink (`ColdScanGate` + `ColdScanTeaser`)

A `/report/{owner}/{repo}` hit with **no persisted snapshot** never auto-starts a scan — it renders
`ColdScanGate`, which asks first (a shared link shouldn't spend minutes of model time uninvited) and
keeps any pinned `@sha` on the ref handed to `ReportClient`.

Under the CTA, `ColdScanTeaser` shows **what a scan produces**, derived from the maturity model: the
`DIMENSIONS` chips, the `LEVELS` ladder (all five, none marked), and the terms — free for public
repos, no account, minutes not seconds, a capped free monthly allowance that ends in a sign-in prompt,
nothing cloned, and a public report saved at the URL. It deliberately shows **no sample score, blurred
ring, or "typical result"**: the same honesty rule the charts follow (below) applies before a scan
exists. The no-wait alternative is a link to the real demo org, not a mock-up.

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
12. **Badge share** — level + gate badges with copy buttons (see [badge.md](../billing/badge.md)).

`ReportView` also reconciles the live report against persisted history on mount: it fetches
`/api/history` + `/api/recommendations`, builds the chronological trend points (appending
the current scan if not yet stored), and picks the correct baseline for deltas.

## Charts (`src/components/report/Charts.tsx`, `TrendChart.tsx`, `DimensionTrends.tsx`)

| Component | Renders | Interaction |
| --- | --- | --- |
| `ScoreRing` | Overall score as an SVG progress ring; arc length **and** color encode the score (color-blind-safe). | static |
| `RadarChart` | The dimensions as a radar polygon with 25/50/75/100 rings. | hover snaps to nearest vertex; SR-table fallback |
| `RadarFallback` | The under-3-dimension form: labeled bars. | per-row picker buttons |
| `TrendChart` | Overall-score history; background bands shade the 5 levels. | hover crosshair + `PointTooltip` (score, date, engine, delta) |
| `Sparkline` | One dimension's score history inline (132×34). | hover crosshair |
| `PostureQuadrant` | Adoption (x) × rigor (y) plot with a glowing dot + trail to prior scan. | mount animation (respects reduced-motion) |
| `DimLine` | A dimension's trend line; null points render as breaks, never 0-crossings. | hover tooltip |

The hover layer is shared (`src/components/report/chartHover.tsx`: `useChartHover`,
`ChartTooltip`, `PointTooltip`). Color/glyph mapping lives in `src/lib/ui.ts`
(`scoreHex`, `scoreGlyph` — L1 red → L5 green, ○ → ●).

### The honesty rules every chart follows

A chart that renders confidently on nothing, too little, or untrustworthy data is worse
than no chart. Each of these is a load-bearing behavior, not a style choice:

- **Nothing to draw → say so.** `RadarChart` renders "No dimension data" for an empty set;
  `DimLine` renders a "No trend data" placeholder (not the bare band/gridline frame) when
  every value in the series is null. An all-*zero* series is not empty — it plots.
- **Too few axes → change the form.** Under 3 dimensions a radar's polygon is a point or a
  zero-area line, so `RadarChart` hands off to `RadarFallback` (labeled bars) rather than
  drawing an invisible shape over data that exists.
- **A zero is a zero, never a small score.** Radar vertices plot at their true fraction —
  there is no minimum-radius floor. A 0 sits at the centre and is marked with a hollow
  dashed ring (plus a legend); a filled dot at any radius would assert a magnitude.
  `ScoreWaterfall` segments carry no pixel floor either: their widths *are* their point
  contributions, sub-1.5pt contributions aggregate into one labeled neutral sliver
  (`scoreWaterfallSegments.ts`), and the headroom-to-100 tail is the honest remainder.
- **Mock-scored points are marked.** `engine.provider === "mock"` means the deterministic
  rubric scored the scan and no model contributed, so those points are not comparable to
  model-scored ones. `TrendChart` and `DimLine` draw them **hollow** (score-coloured stroke,
  surface fill — the mark changes, the value ramp does not), any series containing one shows
  the legend footnote, and the caveat is repeated in the SR table / point list rather than
  living only in the hover tooltip. Predicates: `src/components/report/chartEngine.ts`.
- **A degraded load is not a finished one.** `DimensionTrends` treats a parsed history whose
  scans all carry empty `dimensions` arrays as a load *failure* (retry UI), not as nine
  successfully-loaded "—" cards.

## Comparison (`src/lib/report/compare.ts` + `WhatChanged`)

`diffScans(before, after)` is a pure diff engine returning a `ScanDiff`: overall/adoption/
rigor `AxisDelta`s, a `LevelTransition`, posture change, per-dimension `DimensionDiff[]`,
closed/opened gap counts, appeared/disappeared signal counts, recommendations moved to
done, and human-readable `movements[]` attribution lines sorted by magnitude. Gaps and
evidence are normalized (`norm()`: trim/lowercase/collapse-whitespace) for set comparison;
deltas are `null` unless **both** scans scored the dimension (no invented movement).

When exactly one side scored a dimension — a rubric/model change added or dropped it —
`DiffBar` renders no delta at all. It shows an explicit badge ("New in this scan — no
baseline to compare" / "No longer scored — nothing to compare" / "Not scored in either
scan") over a hatched neutral fill, deliberately *not* the emerald/red gain-loss hues: a
change in what was measured is not an improvement or a regression, and the old plain
score-coloured bar was indistinguishable from a dimension that held steady.

`WhatChanged` (`src/components/report/WhatChanged.tsx`, server) renders the diff as a
story — signal-count badges, "why it moved" attribution, level/posture transitions, axis
diff bars, per-dimension `DimensionDiffCard`s, and completed recommendations.
`ScanComparePicker` (client) holds the two-scan selection entirely in the URL
(`?a=&b=`) so the comparison is shareable and back-button-safe. It shows an inline
warning (no hard block) when the chosen baseline is chronologically *newer* than the
compared scan — an inverted pair renders an all-red diff that reads as a regression
while actually looking backward in time.

## Trends / history

- `GET /api/history?repo=owner/repo` → `RepositoryHistory` (repo + `HistoryPoint[]`).
  Requires `DATABASE_URL` (503 otherwise); org-scoped and session-gated when auth is on.
- `DimensionTrends` (`src/components/report/DimensionTrends.tsx`) fetches history and
  renders an overall `TrendChart` plus a small-multiple `DimLine` per dimension, with a
  range toggle (5d / 30d / 90d / all). Ranges are **calendar** windows in the canonical org
  time zone (`rangeCutoff` → `addDaysInZone`), half-open at the bottom and unbounded at the
  top: "5d" is today plus the four calendar days before it, and a clock-skewed future scan
  stays visible.

### Depth: one cap for the chart and the CSV

`HISTORY_SCAN_CAP` (`src/lib/history/limits.ts`, 200 — the DB reader's hard clamp) is the depth
both the `/trends` page and `?format=csv` read. The page used to fetch 60 while the export pulled
200, so "All" was a silent truncation. When the cap is actually binding the page says so
(`historyCapNote`): *"Showing the newest 200 scans — 'All' is capped at this depth, and the CSV
export covers exactly the same 200."*

### Trajectory forecast — fit over full history, never the displayed range

`fitTrendForecast` (`src/app/trends/forecast.ts`) takes **no range argument by construction**. The
forecast is fit over the repository's full recorded history, so flipping 5d/30d/90d/All cannot change
the ETA — a projection that moves when the viewer changes a zoom control is not a projection, and a
5-day re-fit produces a confident-looking ETA from noise. `TrajectoryPanel` states the basis on
screen ("All-time trajectory · fit over all N scans … does not follow the range toggle below").

Below a shared sample floor the forecast is **suppressed, not annotated**:
`forecastInsufficiency` (`src/lib/maturity/forecast.ts`) requires `MIN_FORECAST_POINTS` (3 distinct
scan days) *and* `MIN_FORECAST_SPAN_DAYS` (14 days of calendar span) — many scans inside one week is
still one week. Below either, the panel renders the reason instead of an ETA + confidence figure.

### Timeline annotations

`deriveTrendAnnotations` (`src/app/trends/annotations.ts`) derives markers from the scan series
already on hand — maturity-band crossings (promotion / demotion) and regressions at the same
`DEFAULT_THRESHOLDS.overallDrop` the alerting path uses — as `TrendAnnotation { at, kind, label,
detail, delta, sha, commitSha }`, rendered as a dated "Events on this timeline" strip. Deploy/release
markers are deliberately not invented (no deploy feed is ingested yet); such a feed maps onto the
same shape. In-chart vertical rules are the pending step, positioned by matching `at` against a
point's timestamp — never by array index, since the chart slices by range and the annotation list
does not.

### Export CSV

The trends "Export CSV" control is a client fetch (`src/app/trends/ExportCsvButton.tsx`), not an
anchor to the API route: a 401/403 from an expired session renders an in-page re-auth prompt instead
of replacing the page with a raw JSON error body, and a success streams to a Blob download that keeps
the page and its range state intact.

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

## Conformance ingest (`POST /api/report/conformance`)

A repo's own `.ai/doctor.mjs` posts `{ repo, headSha?, score, fails, warns }` here; the route bounds
the self-attested numbers (score 0-100, fails/warns 0-100 000, truncated to integers) and writes them
onto the Repository row via `recordConformance`, which uses `headSha` to reject a stale re-run of a
superseded commit (`{ stale: true }`).

This is a **cross-tenant write**, so the credential must name the org it may write. Accepted, in order:

| Credential | Binding |
| --- | --- |
| `Authorization: Bearer askl_…` (org API token, `telemetry:write` scope) | `authorizeOrgApi` refuses unless the token's org equals the owner of `repo` — a token for org A cannot post org B's score. **Preferred for CI.** |
| Session cookie | `requireOrgAccess(owner)` — the interactive maintainer path. |
| `Authorization: Bearer $CONFORMANCE_INGEST_TOKEN` | **Legacy, deprecated.** One deployment-wide value bound to no org, so any holder could overwrite any repo's score. Still accepted (live runners depend on it) but logs a warning on every use. |

Set `CONFORMANCE_INGEST_STRICT=1` once every runner has moved to a per-org token: the legacy shared
token is then refused with a 403 and only the two bound credentials work. Clamping applies on every
path — the unattended reporter is not more trusted than a browser.

## Share exports (`GET /api/report/llm`, `GET /api/report/share-card`)

Two export routes sit beside the PDF, both keyed the same way (`?repo=owner/name[@sha]`), both
read-gated by the owning org (`readableOrgForOwner` → `requireOrgRead`, gate before read), and both
404 rather than trigger a scan when the repo has no persisted report.

| Route | Output | Plan-gated? |
| --- | --- | --- |
| `/api/report/llm` | `text/markdown` — the LLM briefing (headline, dimension table, gaps, roadmap, "Ask"). | **No.** |
| `/api/report/share-card` | `image/png` (attachment) — the 1200×630 score card. | **No.** |
| `/api/report/pdf` | `application/pdf` (attachment). | **Yes** — Pro and up. |

Neither new route is plan-gated, and the asymmetry with the PDF is deliberate:

- **`/llm` is the transport for something already free.** Its body is byte-for-byte what the report
  header's "Copy for LLM" chip puts on any viewer's clipboard — one generator,
  `reportLlmMarkdown()` in `src/lib/report/llm-markdown.ts`, imported by both. Gating the fetch
  would tax automation while a human with identical access clicks a button. If the copy chip ever
  becomes a paid surface, the route moves with it: the entitlement belongs to the payload.
- **`/share-card` re-serves the public unfurl.** It renders `ReportShareCard`
  (`src/lib/og/report-card.tsx`) — the same artwork the report permalink already publishes as its
  OpenGraph image — so gating it would protect nothing.

The PDF, by contrast, is a distinct rendered deliverable sold as an entitlement.

Both carry the report's caveats, because both travel detached from the page that would otherwise
explain them: the markdown leads with an `incomplete` warning, a mock-provenance block ("no language
model contributed"), and the scan's `warnings`; the card **refuses to draw a number at all** for an
`incomplete` scan (a renormalized 0/100 is not a measurement) and shows a DEMO badge for a
mock-engine report.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/report/conformance/route.ts` | `.ai/` conformance ingest: org-bound auth, clamping, ledger write. |
| `src/app/api/report/llm/route.ts` | Machine-readable markdown export — the "Copy for LLM" payload as a fetchable endpoint. |
| `src/lib/report/llm-markdown.ts` | `reportLlmMarkdown()` — the single briefing generator behind both the copy chip and the endpoint. Pure/client-safe and deterministic. |
| `src/app/api/report/share-card/route.ts` | Downloadable PNG share card (attachment), rendered from the shared OG card. |
| `src/lib/og/report-card.tsx` | `ReportShareCard` — the 1200×630 artwork shared by the permalink's `opengraph-image` and the share-card download. |
| `src/app/api/report/pdf/route.ts` | Single-report PDF export. Read-gated by the owning org, then plan-gated (`planAllowsPdfExport`, Pro and up); `PUBLIC_ORG` reports are exempt from the plan check, matching the unmetered public-scan model. |
| `src/lib/pdf/report-document.tsx` | The exported PDF's layout (`@react-pdf/renderer`). Includes a "Roadmap & recommendations" section (title, impact/effort, rationale — sorted quick-wins-first, same ordering as the in-app roadmap), a caveat box surfacing `report.warnings` near the top, and a fallback "Incomplete scan" banner for a sparse/zero-dimension report so a degraded scan's PDF reads as caveated rather than a confident empty document. |
| `src/components/report/ReportClient.tsx` | Live-scan orchestration: SSE stream, progress UI, validation. |
| `src/components/report/ReportView.tsx` | The full report render (all sections + trackers/panels). |
| `src/components/report/Charts.tsx` | `ScoreRing`, `RadarChart`, `PostureQuadrant`. |
| `src/components/report/TrendChart.tsx` | Overall trend + `Sparkline`. |
| `src/components/report/DimensionTrends.tsx` | Per-dimension small multiples + range toggle. |
| `src/app/trends/forecast.ts` | The trends forecast fit — full history, no range argument. |
| `src/app/trends/TrajectoryPanel.tsx` | All-time trajectory panel; refuses to project a thin sample. |
| `src/app/trends/annotations.ts` | Band-crossing / regression markers for the timeline. |
| `src/app/trends/ExportCsvButton.tsx` | CSV download as UI (401 → re-auth prompt, not raw JSON). |
| `src/lib/history/limits.ts` | `HISTORY_SCAN_CAP` + the "newest N" cap note. |
| `src/components/report/WhatChanged.tsx` | Diff story renderer. |
| `src/components/report/ScanComparePicker.tsx` | URL-driven two-scan picker. |
| `src/components/report/RadarFallback.tsx` | Labeled-bar form for 1-2 dimensions. |
| `src/components/report/scoreWaterfallSegments.ts` | Floor-free waterfall segment layout + headroom. |
| `src/components/report/chartEngine.ts` | Mock-vs-model point provenance predicates + caveat copy. |
| `src/components/report/deltas.tsx` | `DeltaPill` / `DeltaTag` chips. |
| `src/lib/report/compare.ts` | `diffScans()` pure diff engine. |
| `src/lib/report/validate.ts` | `parseScanReport()` trust-boundary validation. |
| `src/lib/ui.ts` | Color/glyph/format helpers shared across the report. |

## Known gaps

- **Textual, not semantic, diffing** — `norm()` collapses whitespace/case but won't equate
  reworded evidence ("uses GitHub Actions" vs "GitHub Actions detected").
- **No LLM-reasoning drill-down** — `ProvenanceTrack` shows *that* the LLM adjusted a
  score, not the full rationale beyond the dimension summary.
