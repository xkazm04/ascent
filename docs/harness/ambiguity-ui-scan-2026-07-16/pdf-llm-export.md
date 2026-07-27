# PDF & LLM Export — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. PDF export anchors have no loading or error UX — a failed export navigates the user off the app onto raw JSON
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/report/ReportHeader.tsx:93` (also `src/app/org/[slug]/security/page.tsx:82`; server side `src/app/api/report/pdf/route.ts:22,45-67`)
- **Scenario**: "Export PDF" / "Download PDF" are plain `<a href>` links to the PDF routes. The route itself acknowledges the render is CPU-bound enough to need `maxDuration = 60` — yet the click gives zero pending feedback for up to a minute, and users re-click (server does the whole render again). Worse, every error branch (404 "Scan it first", 503 DB hiccup, 500 render failure) returns `application/json` with no Content-Disposition, so the browser *navigates away from the report page* and displays `{"error":"..."}` as the whole document. The carefully written user-facing error copy is shipped as raw JSON with no way back but the Back button.
- **Root cause**: The download flow was designed only for the happy path (200 → attachment stays on-page); the error contract was designed for a fetch() consumer that never materialized.
- **Impact**: A Private-tier paid feature dead-ends into a JSON screen on any transient failure; long renders look like a broken button. This is the single worst UX moment in the export surface.
- **Fix sketch**: Replace the anchors with a small client `DownloadPdfButton` (same chip styling): `fetch` → check `res.ok` → `blob()` + object-URL download; show a spinner/disabled state while pending and an inline/toast error (reusing the route's JSON `error` message) on failure. Alternatively, minimum server-side patch: return error bodies as tiny HTML with a "back to report" link.

## 2. Org export silently widens scope: an unknown segment id exports the ENTIRE fleet
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/api/org/export/route.ts:34` (filename at `:114`)
- **Scenario**: `segment=<id>` is validated by lookup, and a bogus/stale id resolves to `segmentId = null` — the whole-org dataset. The comment says "like the pages", but the trade-off is not equivalent: a page renders inside UI that shows which segment is active, while a CSV *leaves the app* carrying no scope marker at all. The filename (`ascent-<kind>-<org>.csv`) encodes neither segment nor date, so a segment export and a full-fleet export are byte-level indistinguishable to the person it gets forwarded to.
- **Root cause**: The lenient fallback was copied from a read-only page context into a data-egress context without re-examining the blast radius; the decision to fall back rather than 400 is recorded, but the over-export consequence is not.
- **Impact**: A stale bookmark, renamed segment, or typo'd automation URL silently exports all contributors/passports/teams instead of the intended slice — plausibly shared outside the org under the assumption it is segment-scoped. Two exports with different scopes also collide on filename.
- **Fix sketch**: Return 400 ("unknown segment for this org") when `segParam` is supplied but doesn't resolve — explicit request, explicit failure. Independently, append the resolved segment id (or `all`) and an ISO date to the CSV filename, and include `segment` in the JSON envelope next to `org`/`kind`.

## 3. PDF response is cached 5 minutes while every sibling export is no-store — a fresh rescan can download the old report
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/app/api/report/pdf/route.ts:77` (contrast `src/app/api/org/export/route.ts:115,119`)
- **Scenario**: The PDF route sends `cache-control: private, max-age=300`; the org export routes send `private, no-store`. The 300 is uncommented — every other non-obvious decision in this file carries a rationale block, but not this one. When the user clicks "Retest" in `FreshnessControl` (which sits directly beside "Export PDF" in `ReportHeader`) and then exports without `@sha`, the browser may satisfy the request from cache and hand them a PDF of the *pre-rescan* report — with no indication it is stale.
- **Root cause**: A performance trade-off (avoid re-rendering a CPU-bound PDF on double-click) was made implicitly and inconsistently with the sibling export routes' caching policy.
- **Impact**: User rescans, exports, and sends a customer/leadership a PDF whose scores don't match the on-screen report — a trust-eroding mismatch that is nearly impossible for them to diagnose.
- **Fix sketch**: Either switch to `private, no-store` for parity with the other exports (the double-render cost is bounded and rare), or keep the cache but key it correctly — e.g. redirect the sha-less form to the report's concrete `@headSha` URL — and document why 300s is safe in a comment matching the file's own standard.

## 4. CopyForLlm "Copy failed" is a dead end — no recovery path to the payload
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/CopyForLlm.tsx:75-76` (fallback at `:89-104`, state machine `src/components/copy-for-llm.logic.ts:57-61`)
- **Scenario**: When both the async Clipboard API and the `execCommand` fallback fail (clipboard blocked by Permissions-Policy, embedded/iframe context, some mobile browsers — and `execCommand` is deprecated so its reach only shrinks), the button flashes "⚠ Copy failed" for 2.5s and returns to idle. Retrying will fail identically. The markdown payload exists in memory but the user is given no way to reach it — this is the *only* delivery mechanism for the "paste your scan into your own LLM" feature.
- **Root cause**: The failure state was designed as feedback ("it didn't work") rather than as an alternate path to the goal ("here's the text anyway"); only the happy path delivers the product value.
- **Impact**: In any clipboard-restricted context the entire copy-for-LLM feature — advertised across briefings, reports, security, skills — is unusable, and the user can't even work around it manually.
- **Fix sketch**: On failure, render the payload in a readonly `<textarea>` (auto-selected, e.g. in a small popover/dialog with a "select all" hint) so manual Ctrl+C always works. The existing failed state becomes the trigger for that fallback surface rather than a terminal message.

## 5. The export "chip" button is hand-rolled three ways in the same toolbar rows
- **Severity**: Low
- **Category**: component-extraction
- **File**: `src/app/org/[slug]/security/page.tsx:83` (vs `src/components/CopyForLlm.tsx:67-73` and `pillClass` in `src/components/report/ReportHeader.tsx:94`)
- **Scenario**: Three implementations of the same visual chip coexist, two of them side by side in one flex row: the security page's Download-PDF anchor duplicates CopyForLlm's idle class string verbatim (`focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 ... hover:border-accent hover:text-white`), while ReportHeader's Export-PDF anchor uses the separate `pillClass` helper. CopyForLlm itself mixes semantic tokens (`accent`, `danger`) with raw palette values (`slate-700`, `emerald-500/10`) for its states — success has no semantic token at all.
- **Root cause**: No shared chip/button primitive for the "action chip in a header toolbar" pattern, so each surface re-derived it; the copy-paste already shows the beginning of drift (two sizing/radius systems for adjacent buttons).
- **Impact**: Adjacent buttons can drift in padding, radius, focus and hover treatment with any future tweak; the raw emerald/slate values bypass the theme, so a palette change leaves stale greens/greys in the export surface.
- **Fix sketch**: Extract one `chipButtonClass({ state })` (or a small `ActionChip` component) exposing idle/success/danger variants built on the semantic tokens (add a `success` token to stand beside `danger`), and use it in CopyForLlm, both PDF anchors, and future toolbar actions.
