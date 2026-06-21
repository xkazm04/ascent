> Total: 5 findings (0 critical, 0 high, 4 medium, 1 low)

# PDF & LLM Export — combined bug+ui scan

## 1. PDF export collapses transient DB errors into a misleading "no scan exists" 404
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / error-handling
- **File**: src/app/api/report/pdf/route.ts:39
- **Scenario**: `getScanReportByCommit(...).catch(() => null)` catches *every* error. When the DSQL/Aurora read transiently fails (cold-start, pool exhaustion, network blip) for a repo that genuinely has a saved scan, the route returns 404 with "No saved scan for this repository yet. Scan it first, then export."
- **Root cause**: The blanket `.catch(() => null)` conflates "row legitimately absent" with "read failed", so a recoverable infra error is reported to the user as a permanent missing-data condition.
- **Impact**: User is told to re-run a scan they already have (potentially burning a credit/quota) and the real outage is hidden from logs/metrics; the route never distinguishes 503-retryable from 404-not-found. The render path below it already does the right thing (catches, logs, returns 500), so this is an inconsistency in the same handler.
- **Fix sketch**: Drop the swallowing `.catch`; wrap the read in try/catch that logs and returns 503 on a thrown error, and only return 404 when the resolved report is `null`.

## 2. CSV formula-injection guard misses leading TAB / CR / whitespace prefixes
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: security (CSV/formula injection)
- **File**: src/app/api/org/export/route.ts:22
- **Scenario**: `csvField` neutralizes a cell only when it starts with `= + - @` via `/^[=+\-@]/`. A contributor display name like `"\t=HYPERLINK(\"http://evil\",\"x\")"` or `" =cmd"` (leading tab/space) bypasses the regex; Excel and Google Sheets trim leading whitespace/tab/CR before formula evaluation, so the cell still executes when the exported CSV is opened.
- **Root cause**: The dangerous-prefix check anchors on the first character only, but spreadsheet apps treat TAB (0x09), CR (0x0D) and a leading space as ignorable, effectively shifting the formula trigger past position 0. OWASP's CSV-injection guidance lists tab and carriage return as leading triggers too.
- **Impact**: Re-opens the spreadsheet-formula-injection vector the guard was added to close, for any field sourced from attacker-controlled GitHub data (contributor `name`/`login`, repo `name`/`fullName`).
- **Fix sketch**: Strip/inspect leading whitespace before the test, e.g. test against `s.replace(/^[\s]+/, "")` or broaden the class to `/^[\s=+\-@\t\r]/` and prefix `'` (forcing literal) whenever any leading dangerous char is present.

## 3. PDF/export download links have no loading or disabled state
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-loading-state / UX
- **File**: src/components/report/ReportHeader.tsx:58
- **Scenario**: "Export PDF" is a plain `<a href="/api/report/pdf?...">`. The endpoint is a synchronous, CPU-bound `renderToBuffer` that can take several seconds for a large report. The link gives zero feedback after click — no spinner, no disabled state, no progress — so the user sees nothing happen and clicks again, queuing multiple expensive server renders. The Executive ("Download PDF", executive/page.tsx:60) and Security PDF links share the identical pattern.
- **Root cause**: A heavyweight server export is wired as a bare navigation anchor, modeled as if it were an instant static download; there's no pending-state affordance for a multi-second async action.
- **Impact**: Perceived-broken UX on slow/large exports plus avoidable repeated server-side PDF renders (resource amplification). Inconsistent with `CopyForLlm`, which does show copied/failed transient states.
- **Fix sketch**: Add the HTML `download` attribute and convert to a small client control that shows a pending/disabled state on click (or use `fetch` + blob with a spinner), re-enabling on completion/error.

## 4. CopyForLlm announces stale label to screen readers via aria-live on the button
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: src/components/CopyForLlm.tsx:41
- **Scenario**: `aria-live="polite"` is placed on the `<button>` whose own visible label is the live region's content. When the label flips idle→"Copied"→idle the whole button (including the decorative icon and any surrounding text) is re-announced, and on the auto-reset back to idle the original label ("Copy for LLM") is announced again as if it were a new event — a confusing double announcement for AT users.
- **Root cause**: The live region and the interactive control are the same element, so every label transition (including the silent reset) is treated as an announcement.
- **Impact**: Noisy/misleading screen-reader output on every copy; the reset-to-idle announcement implies an action that didn't happen.
- **Fix sketch**: Move the transient status text into a separate visually-hidden `<span role="status" aria-live="polite">` that holds only "Copied"/"Copy failed" (empty when idle), and keep the button's accessible name static.

## 5. PDF export of a report with empty body sections renders a near-blank document with no caveat
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: empty/missing-data export
- **File**: src/lib/pdf/report-document.tsx:88
- **Scenario**: For a minimal/degraded scan (e.g. a mock-engine or low-coverage report where `strengths`, `risks`, and `dimensions` are all empty), the strengths/risks block is skipped entirely (the `&&` guard at line 88) and the "Scoring by dimension" section renders its header with zero rows. The PDF the user pays for / shares shows a score and headline followed by an empty dimensions heading and a footer — no "insufficient data" note, even though `report.warnings` (low-coverage / mock-fallback caveats) exists on the type and is computed by the reader.
- **Root cause**: The document renders the numeric headline unconditionally but treats empty content arrays as "omit silently"; `report.warnings` is never surfaced in the PDF, so a low-confidence export looks identical-in-confidence to a full one minus the missing sections.
- **Impact**: A board-/exec-facing artifact silently presents a thin or mock-derived report as authoritative, and an empty dimensions header looks like a rendering bug rather than a data state.
- **Fix sketch**: Render `report.warnings` as a visible caveat strip near the header, and show an explicit "No per-dimension scores available for this scan" placeholder when `report.dimensions.length === 0` (mirror the existing "None surfaced." empty-state used for strengths/risks).
