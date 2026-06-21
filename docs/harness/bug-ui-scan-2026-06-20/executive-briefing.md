> Total: 6 findings (0 critical, 3 high, 3 medium, 0 low)

# Executive Briefing — combined bug+ui scan

## 1. Segment scope silently dropped from the PDF download and the share link
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: data-correctness / wrong-tenant-deliverable
- **File**: src/app/org/[slug]/executive/page.tsx:60
- **Scenario**: A reseller opens `/org/<slug>/executive?segment=<clientA>` — the on-screen briefing is correctly scoped to client A (page.tsx:30-31 reads `sp.segment` and threads it into `buildExecBriefing`). They then click "Download PDF" or "Share read-only link". The PDF href (page.tsx:60-66) is built as `?org=…&range=…&from=…&to=…` with **no `&segment=`**, and `BriefingShareButton` (page.tsx:67) is given only `org/range/from/to`. The PDF route and share route therefore call `buildExecBriefing` with `segmentId = null`.
- **Root cause**: The export/share URLs were assembled from the window only; the active `segmentId` (which the page itself honors) was never appended. The PDF route *supports* `?segment=` (pdf/route.ts:33) and the rollup scopes correctly by it — but nothing ever sends it from this page.
- **Impact**: A reseller generating a "per-client deliverable" (the documented use case, pdf/route.ts:32) downloads or shares the **whole-org** briefing instead of the client segment they are looking at — wrong/over-broad data handed to an external party. Silent: numbers look plausible, just for the wrong scope.
- **Fix sketch**: Append `${segmentId ? "&segment=" + encodeURIComponent(segmentId) : ""}` to the PDF href, and add a `segment?` prop to `BriefingShareButton` + carry it in the share POST body and into `signBriefingShareToken`/`verifyBriefingShareToken` so the shared page re-runs scoped.

## 2. Mock-degraded provenance warning is absent from the PDF and the shared link
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / misleading-durable-artifact
- **File**: src/lib/pdf/briefing-document.tsx:84
- **Scenario**: A quarter where some repos were scored by the deterministic Mock engine (`engineMixDegraded(mix) === true`). The interactive page (executive/page.tsx:124-133) and the "Copy for LLM" markdown (briefing.ts:319-322) both render "⚠ some scores used the deterministic mock engine, not the live model". The **PDF** (`BriefingDocument`) references neither `engineMix` nor the degraded warning, and the **shared board page** (share/briefing/[token]/page.tsx) omits it too.
- **Root cause**: `engineMix` provenance was added to `ExecBriefing` precisely "so a mock-degraded quarter is auditable in the durable briefing, not just the transient scan stream" (briefing.ts:101-103), but only the two ephemeral surfaces (web page, clipboard) actually render it. The two leadership-facing durable surfaces (downloadable PDF, account-less board link) drop it.
- **Impact**: A mock-degraded quarter is visually indistinguishable from a fully-live quarter on exactly the artifacts handed to a board / renewal owner — the audit signal the field exists for is invisible where it matters most.
- **Fix sketch**: Render `engineMixLabel(b.engineMix)` + the degraded warning as a footer/meta line in `BriefingDocument`, and add the same provenance/warning line to the shared page.

## 3. Regression warning ("N repos regressed") missing from the shared board link
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-completeness / omitted-risk-signal
- **File**: src/app/share/briefing/[token]/page.tsx:65
- **Scenario**: A period in which `briefing.regressionCount > 0`. The internal Executive page renders an orange "⚠ N repos regressed this period" line (executive/page.tsx:146-151). The shared page only renders `forecastHeadline` inside its Trajectory card (share page:65-70) and never reads `regressionCount`, so a board member sees the trajectory headline with no regression caveat.
- **Root cause**: The shared page claims to expose "only what the Briefing tab shows" (share page:4) but was built to a subset that drops the regression risk signal (and also `valueRealized`, `adoptionRate`, `movement`).
- **Impact**: The account-less audience — the people most likely to read a rosier story — is shown trajectory without the offsetting "but N repos regressed" warning that internal viewers get. Optimistic-skew of the externally shared view.
- **Fix sketch**: Mirror the page's regression caveat (and ideally the value/adoption/movement lines) on the shared page, gated on `regressionCount > 0`.

## 4. Shared-link maturity tile shows a bare delta with no comparison label
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: consistency / ambiguous-number
- **File**: src/app/share/briefing/[token]/page.tsx:59
- **Scenario**: On the internal page the Org-maturity Tile passes both `delta` and `deltaLabel={period.comparisonLabel}` (executive/page.tsx:78-79), rendering e.g. "▲+4 vs 90d ago". The shared page passes `delta={briefing.periodDelta}` with **no `deltaLabel`** (share page:59), so a board member sees a bare "▲+4" with no indication of what it is measured against.
- **Root cause**: `resolveWindow` (used by the shared page) returns `comparisonLabel`, but the shared tile never forwards it to the Tile.
- **Impact**: An unlabeled delta on the headline number for the least-context audience — "+4" against what? Reads as polish-debt but on the board-facing surface.
- **Fix sketch**: Pass `deltaLabel={period.comparisonLabel}` to the shared page's Org-maturity Tile (period is already resolved at share page:38).

## 5. PDF date-window resolution ignores the saved-period cookie, diverging from the page
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: consistency / window-mismatch
- **File**: src/app/api/org/briefing/pdf/route.ts:27
- **Scenario**: A user picks "30 days" on the Overview tab (which persists to the `ascent_period` cookie) then opens Executive with no `?range=` in the URL. The page resolves the window via `resolveOrgWindow` (executive/page.tsx:28), which honors the cookie → renders a 30-day briefing. But the "Download PDF" link is built from `period.key` (resolved on the page, so the link *does* carry `&range=30d`) — however the PDF route itself calls bare `resolveWindow({ range, from, to })` (pdf/route.ts:27-31), which has **no cookie fallback**. If the range query param is ever absent/empty (e.g. an old bookmarked link, or `period.key` resolving to the default while the cookie said otherwise), the PDF silently falls back to the 90d default instead of the user's remembered period.
- **Root cause**: The page standardized on `resolveOrgWindow` (cookie-aware) specifically because "sibling tabs called resolveWindow(sp) directly — so a range chosen on Overview was lost" (period.ts:4-7). The PDF/share routes still call the cookie-blind `resolveWindow`, reintroducing the exact drift the helper was created to fix when the range param isn't explicitly present.
- **Impact**: PDF (and shared link) period can disagree with the page the user is looking at — a "last 30 days" screen exporting a "last 90 days" PDF. The doc comment promises "all three stay in lockstep" (pdf/route.ts:5), which only holds while `range` is explicitly carried.
- **Fix sketch**: Either always emit an explicit `&range=` (already done on this page, so the immediate risk is bounded), or have the routes read the period cookie when `range` is absent so the fallback matches the page.

## 6. "Recommended next move" can recommend a strong dimension as the fleet's weakness
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: aggregation-correctness / misleading-narrative
- **File**: src/lib/org/briefing.ts:357
- **Scenario**: A fleet with exactly 3 scored dimensions, all high — e.g. D1=90, D2=85, D9=80. `strengthDims = slice(0,3)` claims all three, so `riskDims` is empty (the disjoint-list fix, briefing.ts:189-194). `focus = b.risks[0] ?? b.security` then falls through to `b.security` (D9=80), and the page/markdown/Ask all assert: "Raise **D9 Security** — the fleet's weakest dimension at 80/100. It carries the most headroom" (briefing.ts:362, executive/page.tsx:204-206).
- **Root cause**: The "weakest dimension" focus picks `risks[0]`, but on a ≤3-dimension fleet the disjoint-list logic legitimately empties `risks`; the security fallback then labels a *strength* as "the fleet's weakest dimension … carries the most headroom", which is false when D9 is high.
- **Impact**: The product makes a confident, wrong leadership call ("focus here, most headroom") and the LLM Ask elaborates that wrong move into repo-level steps — misdirected effort, on a low-dimension/sparse fleet where the headline is already shaky.
- **Fix sketch**: Only fall back to `security` as the focus when its score is actually low (e.g. below a threshold or below the fleet average); otherwise suppress the "Recommended next move" card/section when `risks` is empty, the same way Movement/Goals self-suppress when empty.
