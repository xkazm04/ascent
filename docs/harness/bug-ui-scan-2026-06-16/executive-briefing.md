# Executive Briefing — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 7

## 1. Final PDF render failure surfaces as an unhandled 500 with a raw stack
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: error-handling / streaming-route
- **File**: src/app/api/org/briefing/pdf/route.ts:44
- **Scenario**: `renderToBuffer` throws (e.g. an unreachable/oversized `logoUrl` that survived branding validation, a font/layout failure, or OOM on a very large fleet). The route does `render(branding).catch(() => branding ? render(undefined) : Promise.reject(...))`. The unbranded fallback `render(undefined)` has **no `.catch`**, and the no-branding branch returns `Promise.reject(new Error("render failed"))`. Either way the rejection escapes — there is no surrounding `try/catch` and no `await ... .catch` on the outer expression.
- **Root cause**: The retry/fallback ladder catches only the *first* render attempt; the second attempt (and the explicit reject) are unguarded, so a render failure becomes an unhandled promise rejection rather than a controlled response.
- **Impact**: The leadership "Download PDF" button returns a Next.js 500 HTML error page (with a stack in dev / opaque error in prod) instead of a clean JSON error like the route's other failure modes. A bad logo can take down the whole export even though the code *intended* to degrade gracefully to an unbranded render.
- **Fix sketch**: Wrap the render ladder so the terminal failure returns a real response: `const buffer = await render(branding).catch(() => render(undefined)).catch(() => null); if (!buffer) return NextResponse.json({ error: "Could not render the briefing PDF." }, { status: 500 });`. This also guarantees the second attempt's failure is handled.

## 2. Strengths and "Weakest dimensions" overlap when the fleet has fewer than 6 scored dimensions
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: data-correctness / slicing
- **File**: src/lib/org/briefing.ts:172
- **Scenario**: `strengths = dimSorted.slice(0, 3)` and `risks = dimSorted.slice(-3).reverse()`. When `dimAverages` has fewer than 6 entries (a freshly-onboarded org, or repos that only exercised a few dimensions), the head and tail slices overlap. With 4 dims, dim #2 and #3 appear in *both* lists; with 1 dim it appears as both the top strength and the top weakness.
- **Root cause**: No de-duplication / size guard between the top-N and bottom-N slices; they assume ≥6 distinct dimensions.
- **Impact**: The board-facing briefing (and PDF) shows the *same* dimension as both a strength and a risk — a credibility-destroying contradiction in an exec artifact. Also propagates to the "Copy for LLM" markdown, so an LLM is fed contradictory inputs.
- **Fix sketch**: Compute risks excluding ids already in strengths, e.g. `const top = dimSorted.slice(0, 3); const risks = dimSorted.filter(d => !top.some(t => t.dimId === d.dimId)).slice(-3).reverse();` (or cap both to `floor(len/2)` when the list is short).

## 3. Empty-data sections render a bare heading with no rows in the PDF
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: empty-state / PDF layout
- **File**: src/lib/pdf/briefing-document.tsx:125
- **Scenario**: `Strengths` and `Weakest dimensions` headers are rendered unconditionally (lines 125–131), then `.map` over `b.strengths` / `b.risks`. The briefing is only `null` when `scannedCount === 0`; an org that has scans but with `dimAverages === []` (scores recorded but no per-dimension breakdown) yields empty arrays. Unlike `topGainers`/`goals` — which are wrapped in `length > 0` guards — these two columns print a heading followed by blank space.
- **Root cause**: Section headers in the two-column block are not gated on their data being non-empty (inconsistent with the conditional sections below them).
- **Impact**: A board PDF with two labeled-but-empty columns looks broken/unfinished — exactly the polish the exec export is meant to deliver. The page UI has `SectionEmpty`/`InlineEmpty` affordances for this; the PDF has none.
- **Fix sketch**: Guard each column (or the whole `twoCol` block) on `b.strengths.length > 0` / `b.risks.length > 0`, and render a muted "No dimension data for this period." `<Text>` when empty, mirroring the page's `InlineEmpty`.

## 4. Long briefings can break across pages mid-row; only Goals opt out of splitting
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: page-break / PDF layout
- **File**: src/lib/pdf/briefing-document.tsx:134
- **Scenario**: A content-rich org (prior-period block with 6 dim rows + 6 movement rows + many goals) overflows A4. Only the goal rows set `wrap={false}` (line 169). The "vs previous period" section, "Movement this period", and their `sectionH` headers have no `wrap`/`break` control, so @react-pdf can place a section header as the last line of a page with its rows on the next page, or split a `rule`+heading away from its content.
- **Root cause**: Page-break behavior is unmanaged for the variable-length sections; `wrap={false}` was applied only to goal rows, leaving headers orphan-prone.
- **Impact**: Orphaned section headings and a `<View style={rule}/>` divider stranding at a page bottom read as low-quality typesetting in a leadership deck.
- **Fix sketch**: Apply `wrap={false}` to each `moveRow`/`dimRow` (as goals already do), and add `minPresenceAhead={36}` (or wrap the heading + first row in a `<View wrap={false}>`) to the `sectionH` elements so a heading never lands alone at a page break.

## 5. `min-w-0` missing on the MoveRow name container lets long repo names overflow the truncate
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: layout / truncation
- **File**: src/app/org/[slug]/executive/page.tsx:229
- **Scenario**: In `MoveRow`, the name `<span>` has `min-w-0 truncate` but its parent flex row (line 228) places it beside a `shrink-0` delta span. The name span itself is not wrapped in a `flex-1 min-w-0` cell — `truncate` on a flex item without a constrained basis can fail to clip, so a very long `owner/really-long-repo-name` pushes the delta off the row or wraps. Compare DimRow (line 218) / the goals row (line 198) which use `min-w-0 flex-1` wrappers correctly.
- **Root cause**: Inconsistent truncation pattern — the name cell lacks the `flex-1` basis the other rows use, so `min-w-0 truncate` has no width to shrink against.
- **Impact**: Minor visual breakage (delta value clipped/misaligned) for orgs with long repo slugs in the Movement panel; cosmetic only.
- **Fix sketch**: Wrap the name in `<span className="min-w-0 flex-1 truncate ...">` and keep the delta `shrink-0`, matching the DimRow/goal-row pattern.
