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
| `/report` | `src/app/report/page.tsx` | Client-driven | Live scan over `/api/scan/stream`; reads `?repo=` / `?fresh=1`, plus the optional scan scope `?ref=<branch\|tag\|sha>` / `?path=<sub-dir>` (see [scan.md](../scanning/scan.md#scan-scope-branch--sub-path)). A scoped scan skips the cache peek, always re-scans, is never persisted, and carries a warning that its score isn't comparable with default-branch scans. `Re-test` and the sign-in round-trip both preserve the scope. |
| `/report/[owner]/[repo]` | `src/app/report/[owner]/[repo]/page.tsx` | Hybrid | Server-renders a persisted scan (`getScanReportByCommit`, optional `@sha`); else falls back to a live stream. Shareable permalink. |
| `/report/compare` | `src/app/report/compare/page.tsx` | Server | `getScanComparison()` (needs DB). Picks two scans via `?a=`/`?b=`, renders the diff. |
| `/trends` | `src/app/trends/page.tsx` | Server | `getRepositoryHistory()` (needs DB), to `HISTORY_SCAN_CAP` — the same depth the CSV export uses. Range-filtered chart, plus an all-time trajectory panel and timeline annotations. |

## The public register + org scorecards (G7-05 / G7-06)

Two crawlable, unauthenticated surfaces built on one read module, `src/lib/register/data.ts`.

| Route | What it is |
| --- | --- |
| `/leaderboard` | The **AI-native register**: every model-scored public repo, ranked, paginated via `?page=N`, with the full nine-dimension breakdown. |
| `/scorecard/[owner]` | An owner's **public scorecard**: the aggregate score/level over that owner's public repos, its own OG card, and a copy-paste badge embed. |
| `GET /api/scorecard/[owner]/badge` | The org-level SVG badge (see [badge.md](../billing/badge.md)). |

**Two invariants, both unit-pinned (`src/lib/register/data.test.ts`):**

1. **Tenancy.** Every query is pinned to the shared public org *and* `isPrivate: false`, both
   predicates are re-asserted on the id-keyed second fetch, and `registerEntryFrom` refuses a private
   row per-row on top of that. "The query returned it" is never treated as proof it may be published.
2. **Provenance.** A `engineProvider === "mock"` scan had no model contribution, so it is **never
   ranked**. It is carried out as `verified: false`, rendered in a separate "Preview scans — not
   ranked" section with the same `demo` qualifier the README badge uses, and excluded from every
   scorecard average. An owner whose public scans are *all* previews gets an explicit "No published
   score yet" state — not an average over previews.

Ranking happens in memory over a bounded candidate window (`REGISTER_CANDIDATE_CAP`, ordered by score
at the DB), so neither surface needs a new column or index. `windowed` discloses when the corpus has
outgrown the window, so "top N" is never quietly presented as "all".

**Crawlability** is a requirement, not a nicety: the ranking is server-rendered (no `"use client"`
anywhere in the path), pagination is plain anchors with `rel=prev/next`, each page carries a
self-referencing canonical plus OpenGraph/Twitter metadata, and `/leaderboard` is listed in
`sitemap.ts`. Per-owner scorecard routes are dynamic and therefore *not* enumerable in the sitemap —
they are discovered through the owner link on every register row, which is why that link exists.

**Opt-in vs opt-out.** These pages republish nothing that isn't already public: the same reports are
already readable one at a time at `/report/{owner}/{repo}` and already listed on the register, so the
aggregate is opt-**out** by default. A *tenant* fleet scorecard (an org's own dashboard aggregates)
would be a genuinely new disclosure and is deliberately **not** built — it needs a persisted per-org
opt-in flag, i.e. a schema change.

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
| `/api/recommendations/[id]` | `PATCH` | `{ status?, assigneeLogin?, targetDate?, note? }` → updated item. Validates against `REC_STATUSES`; 404 if not found, 503 without DB. |

`RecommendationTracker` (inside `ReportView`) shows a progress bar + per-item status
dropdowns with **optimistic updates**, a per-row `savingIds` set (overlapping saves each
disable only their own row), rollback on failure, and an `aria-live` region announcing
each save. When the DB isn't configured it degrades to the read-only `RoadmapSteps`
(sorted impact↑/effort↓, quick wins first).

### "You marked it done — did the score move?"

A backlog closed for appearances used to be invisible to the platform that recommended it:
`diffScans` computed `recsMovedToDone` and nothing ever asked whether the dimension that
recommendation targeted actually improved.

`reconcileDoneRec(dimId, before, after)` (`src/lib/report/compare.ts`) is the pure verdict, in four
states:

| State | Meaning |
| --- | --- |
| `not-measured` | The dimension wasn't scored in **both** scans. There is nothing to compare — this is **not** a failure to improve and is never rendered as one. `delta` stays `null`. |
| `flat` | Both scans measured it; the number is the same. "D3 held at 62 since the previous scan." |
| `improved` / `declined` | Both scans measured it and it moved; the line quotes the actual before → after. |

It is applied in two places from one implementation:

- **`diffScans`** attaches a `reconciliation` to every `RecMovedToDone`, computed off the
  dimension diff it already built — so the compare view's data carries it.
- **`RecommendationTracker`** renders `DoneReconciliation` directly on each `done` row, which is
  **where the user made the call**. Its `after` is the loaded report's own dimension scores; its
  `before` is `prevDimScores`, threaded down from `ReportView` through `ReportPanels`. A `null`
  `prevDimScores` (no prior scan, or history failed to load) correctly reads as *not re-measured*.

The mechanism is **derived at read time from two scans**, not persisted at scan-persist time: the
verdict is a pure function of two numbers the platform already stores, so persisting it would add a
column that can only ever go stale against the scans it summarizes, and would need a backfill to say
anything about history. Read-time derivation also means a later re-scan simply re-answers the
question, which is the honest behavior.

Voice matters here as much as correctness. Ascent is a transition companion, not a grader: the note
is an observation the team is free to disagree with, colours stay muted for `flat` and
`not-measured`, and nothing blocks, reverts, or re-opens a user's `done`.

### Dismissing a gap teaches the next scan

Picking **Dismissed** does not fire the PATCH immediately. The row opens an inline prompt
(`recommendationRowUi.tsx` → `DismissReasonPrompt`) asking *why*, because that reason is the one
piece of context the assessment has no way to derive: "we build with Bazel, so this gap doesn't
apply here."

The reason travels as the PATCH's existing `note`. `/api/recommendations/[id]` then calls
`recordRecommendationDismissal`, which writes an **`OrgDecision`** — the same store the org's
security/teams/passport/contributor decisions live in — under the module `roadmap` and an itemKey of
`${repoFullName}::rec:${dim}:${fnv1a(normalizeRecTitle(title))}`. The hash runs over
`normalizeRecTitle`, the *same* normalizer scan-persist carry-forward uses, so a live-LLM rephrasing
keeps the dismissal attached to its gap.

From there the reason rides the path that already existed: `decisionsForRepo` picks it up by repo
prefix and `prompt.ts`'s `decisionsBlock` renders it into the next scan's **STANDING DECISIONS**
block (per-repo user message, never the cacheable SYSTEM prefix), which instructs the model not to
re-raise a dismissed finding *"unless new evidence contradicts its stated reason"* — the escape
hatch is deliberate, and the block is framed as calibration ("context you were missing, not a reason
to raise the score") so a dismissal can't inflate a score.

Two rules keep this from becoming a silent memory hole:

- **A dismissal with no reason records nothing.** "Dismiss without a reason" is offered as an equal
  button and still dismisses the item — it just writes no decision, so the gap is free to come back.
  Silence must never become permanent suppression.
- **Un-dismissing un-suppresses.** Moving the row to any other status calls
  `clearRecommendationDismissal`, which flips the standing decision to `open` (so `isResolved`
  excludes it and the prompt stops carrying it) without deleting the reason from the record.

`roadmap` is *not* a `FindingModule`: `/api/org/decision` still refuses it and the org nav badges
never look its keys up. It is an `OrgDecision` row purely so it flows through the one
standing-decision path, rather than forking a second suppression list.

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

### Continuous Conformance: trend + scheduled ingestion (G7-23)

`GET /api/report/conformance?repo=owner/name[&limit=50]` returns `{ repo, points, regressed }`, a
history of past reports for that repo, newest-first (`points[i] = { at, score, fails, warns, sha }`).
No new storage was added for this: every accepted POST above already appends a `conformance.reported`
row to the org's tamper-evident audit ledger (`recordConformance`, `src/lib/db/org-watch.ts`) — the
Repository row only ever holds the *latest* score, but the ledger is real per-report history. The GET
handler walks that ledger back via the existing `getAuditLog` reader (the same one `/api/audit` uses),
action-filtered and then repo-filtered in `src/app/api/report/conformance/route.ts` (`getAuditLog` has
no per-repo filter of its own), capped at 10 pages of 100 rows. Gated read-side by
`readableOrgForOwner` → `requireOrgRead`, same as the other report exports; `PUBLIC_ORG` repos are
refused (conformance history is an org-only surface). `regressed` is a computed boolean (newest score
lower than the prior one) returned in the payload only — it is **not** dispatched anywhere; wiring a
regression to a push notification is a job for the alerts system, not this route.

The generated CI workflow (`buildConformanceWiring`, `src/lib/standard/wiring.ts`,
`.github/workflows/ai-conformance.yml`) now also runs on a weekly `schedule` (plus
`workflow_dispatch`), not just `pull_request`: a `scheduled-report` job re-runs the doctor with
`--json` and self-reports via `ASCENT_CONFORMANCE_URL`/`ASCENT_CONFORMANCE_TOKEN` secrets, so a repo
that goes quiet (no PRs) still gets a fresh conformance report instead of the dashboard silently
showing a weeks-stale score. The `pull_request` job is unchanged (still the hard-pass merge gate); the
scheduled job never fails the run.

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

## Customer-repo PR writes require **admin** (`/api/report/{passport,foundation}/pr`)

Both routes open a draft PR into the scanned repository using the **org's GitHub App installation
token**, so both gate on `requireOrgRole(org, "admin")` — not merely `requireOrgAccess` (member),
which is what they used until the gate was unified with `/api/practices/apply{,-batch}`. One action
must not have two gates: a plain member of the org now gets `403 "This action requires the admin role
in this organization."` and no branch, commit, or PR is created. Draft status is a review convenience,
not an authorization boundary, and "the caller can already read this repo" is not the question the
gate answers — the write is. The rest of the chain is unchanged and identical between the two: DB +
App configured, same-origin, signed-in, org-owned (never `PUBLIC_ORG`), installation present.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/report/passport/pr/route.ts` | Draft PR seeding `.ai/passport.json`. Admin-gated (see above). |
| `src/app/api/report/foundation/pr/route.ts` | Draft PR seeding the generated `.ai/` foundation. Admin-gated (see above). |
| `src/app/api/report/conformance/route.ts` | `.ai/` conformance ingest: org-bound auth, clamping, ledger write. The legacy shared `CONFORMANCE_INGEST_TOKEN` is compared with `crypto.timingSafeEqual`, matching the per-org token path. |
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
| `src/lib/register/data.ts` | The public register read layer: `getPublicRegister` / `getPublicOrgScorecard`. Public-org + `isPrivate:false` on every query; mock-engine scans carried as `verified:false` and never ranked. |
| `src/app/leaderboard/page.tsx` | The register page: server-rendered ranking, `?page=` pagination, per-page canonical + OG. |
| `src/components/leaderboard/LeaderboardTable.tsx` | The ranked table. `ranked={false}` draws the unranked preview section; a `demo` chip marks every unverified row. |
| `src/components/leaderboard/RegisterPager.tsx` | Anchor-based pager (`rel=prev/next`) + the shared scan/badge CTA. |
| `src/app/scorecard/[owner]/page.tsx` | Public org scorecard + badge embed snippet. |
| `src/components/leaderboard/ScorecardSummary.tsx` | The scorecard headline; renders the refusal state when `verifiedCount === 0`. |
| `src/app/scorecard/[owner]/opengraph-image.tsx` | Scorecard OG card, on the shared `og-brand` shell; falls back to the neutral card rather than drawing an average over previews. |

## Known gaps

- **Textual, not semantic, diffing** — `norm()` collapses whitespace/case but won't equate
  reworded evidence ("uses GitHub Actions" vs "GitHub Actions detected").
- **No LLM-reasoning drill-down** — `ProvenanceTrack` shows *that* the LLM adjusted a
  score, not the full rationale beyond the dimension summary.
