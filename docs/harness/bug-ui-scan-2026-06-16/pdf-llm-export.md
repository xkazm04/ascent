# PDF & LLM Export — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 3 (in scope) + 4 supporting (types.ts, scans-read.ts, scans-persist.ts, briefing/pdf/route.ts)

## 1. renderToBuffer is unguarded — a render failure 500s the download with no fallback
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: error-handling / robustness
- **File**: src/app/api/report/pdf/route.ts:52
- **Scenario**: `const buffer = await renderToBuffer(element);` is awaited with no try/catch. If `@react-pdf/renderer` throws during layout (a malformed/legacy snapshot whose reconstruction left a nested field `undefined`, an internal renderer bug, or an OOM on a very large dimension set), the route emits an unhandled rejection → a bare Next.js 500 HTML page. The browser, expecting `application/pdf` from a download link, gets an HTML body and either downloads a corrupt `.pdf` or shows a blank error.
- **Root cause**: The DB read at line 39 is defensively wrapped in `.catch(() => null)`, but the render itself — the most failure-prone step — is not. The sibling route `src/app/api/org/briefing/pdf/route.ts:44` *deliberately* wraps `renderToBuffer` in `.catch(...)` (`render failed`) precisely to avoid 500ing the download; this route is inconsistent with that established pattern.
- **Impact**: A single bad report (or any transient renderer error) turns the paid "PDF export" feature into a broken file download with no actionable message. Hard to diagnose because it manifests as a corrupt PDF, not a clean error.
- **Fix sketch**: Wrap line 52 in try/catch (mirroring briefing/pdf): on failure return `NextResponse.json({ error: "Could not render the PDF for this report." }, { status: 500 })` so the client gets a JSON error it can detect (content-type ≠ application/pdf), and log the underlying error for triage.

## 2. Unvalidated owner/name interpolated into the Content-Disposition filename
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: input-validation / header-correctness
- **File**: src/app/api/report/pdf/route.ts:53-57
- **Scenario**: `parseRepo` (lines 18-25) only checks for a `/` separator — it never validates the character set of `owner`/`name`. Those raw query values flow into ``filename = `ascent-${parsed.owner}-${parsed.name}...` `` and then into the header ``content-disposition: attachment; filename="${filename}"``. A request like `?repo=foo/ba"r` injects a `"` that closes the quoted filename early, producing a malformed header; a non-ASCII repo segment (`?repo=foo/náme`) puts bytes outside the HTTP/1.1 token/quoted-string range into a header value, which some runtimes reject (throwing → see finding #1's 500) and others silently mangle, yielding a garbage download filename.
- **Root cause**: No allow-list validation of the repo segments, and no header-safe encoding of the filename. The value is attacker-influenced (it's a URL query param) even though a *matching* report only exists for real repos — the header is built from the query string, not from the DB-stored repo identity.
- **Impact**: Broken `Content-Disposition` header (malformed filename / failed download) and, on strict runtimes, a 500. Low security blast radius (no CRLF — newlines can't reach here via a normal URL), but a correctness and robustness defect.
- **Fix sketch**: Validate `owner`/`name` against `^[A-Za-z0-9._-]+$` in `parseRepo` (return `null` → 400 otherwise), and/or build the filename from the DB-resolved `report.repo.owner/name` and sanitize it (`replace(/[^A-Za-z0-9._-]/g, "-")`). Optionally add `filename*=UTF-8''...` for correct Unicode.

## 3. "Scoring by dimension" header renders even when there are zero dimensions
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: empty-state / partial-data
- **File**: src/lib/pdf/report-document.tsx:116-126
- **Scenario**: The Strengths/Risks block is correctly gated (`report.strengths.length > 0 || report.risks.length > 0`, line 88) AND has inline "None surfaced." fallbacks. The Dimensions block has *neither*: the `<View style={styles.rule} />` + `Scoring by dimension` header always render, then `report.dimensions.map(...)`. A report reconstructed with an empty `dimensions` array (`parseStringArray`/reconstruction can yield `[]` for a sparse or legacy scan) prints a section header followed by blank space — an orphaned heading with no content.
- **Root cause**: Inconsistent empty-state handling across sections — the dimensions section assumes the array is always non-empty, unlike the strengths/risks section right above it.
- **Impact**: A confusing, unprofessional PDF (a heading promising content followed by emptiness) on exactly the low-data reports where polish matters most. Not a crash (`.map` on `[]` is safe), but a visible defect in a paid export.
- **Fix sketch**: Gate the rule+header on `report.dimensions.length > 0`, or render a `<Text style={{ color: FAINT }}>No per-dimension scoring available.</Text>` fallback inside the section (matching the "None surfaced." pattern at lines 94/104).

## 4. CopyForLlm: aria-live on the button announces the label, not just the status change
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/CopyForLlm.tsx:43-59
- **Scenario**: `aria-live="polite"` is placed on the `<button>` itself, whose content is `[icon] + (copied ? "Copied" : failed ? "Copy failed" : label)`. Two problems: (a) a live region should wrap *only* the status text that changes, not the whole interactive control — many screen readers will re-announce the entire button (including the decorative `⧉` glyph context and label) on every state flip; (b) the success/failure feedback is conveyed by color + an emoji glyph (`✓`/`⚠`/`⧉`) with no dedicated text node marked as the announcement target, and the glyph is `aria-hidden`. After the 2s/2.5s timeout the text silently reverts to `label` with no announcement, so a screen-reader user gets inconsistent feedback.
- **Root cause**: Live-region semantics applied at the wrong granularity; status communicated primarily through visual affordances (color + emoji) rather than a politely-announced text status.
- **Impact**: Screen-reader users get noisy or unreliable copy/failure feedback; color-only differentiation of the failed state (`text-danger`) is a contrast/perception concern. Degrades the a11y of a control deliberately placed on *every* results surface.
- **Fix sketch**: Remove `aria-live` from the button; render the status as a separate `<span role="status" aria-live="polite">` (visually the same text) so only the changing string is announced. Optionally keep the button label stable and put "Copied"/"Copy failed" in the adjacent status span.

## 5. CopyForLlm: no guard against empty/whitespace text + no disabled feedback window
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: ux / edge-case
- **File**: src/components/CopyForLlm.tsx:22-41
- **Scenario**: `copy()` writes `text` unconditionally — if a caller passes `""` (e.g., a report/playbook whose markdown brief came back empty), the button cheerfully shows "Copied" having put an empty string on the clipboard, and the user pastes nothing into their LLM with no indication anything was wrong. Separately, the button is never disabled during the 2s "Copied" window, so rapid double-clicks re-fire `copy()` and stack overlapping `setTimeout`s, causing the state to flicker/reset early.
- **Root cause**: No precondition check on `text`, and success state is purely time-based with no interaction lock.
- **Impact**: Silent "copied nothing" on empty payloads (misleading success); minor visual jitter on repeated clicks. Low severity because empty briefs are uncommon, but it undermines trust in the core promise ("paste full scan context").
- **Fix sketch**: Early-return / disable the button when `!text.trim()` (and visually mark it unavailable). Optionally set `disabled` during the feedback window, or clear the prior timeout before scheduling a new one so repeated clicks don't truncate the confirmation.
