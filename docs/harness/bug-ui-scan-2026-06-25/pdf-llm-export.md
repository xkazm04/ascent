# PDF & LLM Export — Bug + UI Scan
> Context: PDF & LLM Export (Reporting & Visualization)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

## 1. org/export sends sensitive org analytics with no Cache-Control header
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/app/api/org/export/route.ts:56-64
- **Value**: impact 6 · effort 1 · risk 1
- **Scenario**: A member exports `/api/org/export?org=acme&kind=contributors&format=csv`. The CSV (contributor logins, names, AI-commit share) and the JSON fallback are returned with NO `cache-control` header. Every sibling export/analytics route in the codebase sets one — `report/pdf`, `org/briefing/pdf`, `org/security/pdf` use `private, max-age=300`; `history` uses `private, no-store`; `audit`/`quota` use `no-store`. This route is the lone exception. A shared/CDN cache keyed on the URL (which carries `org`/`segment` but not the auth cookie) can store the 200 and replay org A's contributor data to a later requester of the same URL, sidestepping `requireOrgRead`.
- **Root cause**: The handler builds the `NextResponse` headers inline and the established "private/no-store on tenant data" convention was simply omitted here.
- **Impact**: Potential cross-tenant disclosure of org analytics via intermediary caches; at minimum a reliability/consistency gap (stale exports).
- **Fix sketch**: Add `"cache-control": "private, no-store"` to both the CSV `NextResponse` and the JSON `NextResponse.json(...)`, matching the other gated routes. Make it impossible by funneling all export responses through one helper that always sets the private cache header.

## 2. Many "Copy for LLM" buttons share the identical accessible name "Copy"
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/CopyForLlm.tsx:39-56 (used at src/components/org/SkillCard.tsx:84 and src/components/org/PlaybookCard.tsx:130)
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: The Skills and Playbooks list pages render one `<CopyForLlm label="Copy" />` per card. A screen-reader user tabbing/listing buttons hears "Copy", "Copy", "Copy"… with nothing tying each button to its skill/playbook. The button has no `aria-label`, and the only context (the skill name `s.name`) lives in a sibling element, not in the control's accessible name.
- **Root cause**: The component derives its accessible name solely from the visible `label`, and the card callers pass the generic `"Copy"` to keep the chip small — fine visually, ambiguous for AT.
- **Impact**: AT users cannot distinguish which item each button copies; degraded, confusing keyboard/SR experience on the core LLM-export surface.
- **Fix sketch**: Add an optional `ariaLabel` prop (fallback to `label`) and have SkillCard/PlaybookCard pass `Copy "<name>" for LLM`. Keeps the compact visible text while giving each button a unique accessible name.

## 3. Rapid re-click double-fires onCopied and resets the "Copied" state early
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/components/CopyForLlm.tsx:26-37
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: `copy()` has no re-entrancy guard. Double-clicking a SkillCard's button fires `onCopied` twice → two `POST /api/org/skills/:id/download` calls → the "use" count (§8.7) is inflated by an ordinary double-click. Separately, the timeouts overlap: click at t0 schedules a reset at t0+2000; a second successful click at t0+1500 schedules another, but the first `setTimeout` still fires at t0+2000 and flips the button back to idle 500ms after the second copy. Also, transitioning to `copied` never clears `failed` (and vice-versa) — they self-heal only because the className checks `copied` first.
- **Root cause**: State is two independent booleans driven by un-cancelled `setTimeout`s, with no in-flight guard around the async copy.
- **Impact**: Mildly inflated best-effort use metric; brief feedback flicker on fast clicks.
- **Fix sketch**: Track the active timeout in a ref and clear it on each new attempt; ignore clicks while a copy is in flight; collapse the two booleans into one `state: idle|copied|failed`.

## 4. A malformed scannedAt aborts the entire PDF render
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/pdf/report-document.tsx:54
- **Value**: impact 4 · effort 2 · risk 2
- **Scenario**: `report.scannedAt ? new Date(report.scannedAt).toISOString().slice(0,10) : ""`. `scannedAt` is a non-optional string normally written as ISO, but a reconstructed snapshot or legacy/garbage value that is truthy-but-unparseable makes `new Date("…").toISOString()` throw `RangeError: Invalid time value`. That throw propagates out of `ReportDocument`, `renderToBuffer` rejects, and the route's catch returns an opaque `500 "Failed to render the PDF."` — the whole export dies over one cosmetic date field.
- **Root cause**: Unguarded `Date` parsing of a persisted string assumed to always be valid ISO.
- **Impact**: A single bad/legacy field makes the paid PDF export unrenderable with no actionable error.
- **Fix sketch**: Parse defensively: `const d = new Date(report.scannedAt); const scannedAt = !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : ""`. Never let a display-only field block the document.

## 5. Null analytics result yields a silent empty 200 export
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/app/api/org/export/route.ts:38-54
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: `getContributorInsights`/`getOrgGovernance` returning `null` is coerced via `insights?.contributors ?? []` / `gov?.perRepo ?? []` to an empty rows array, so the route returns a 200 download containing only the header row. A genuine backend miss (org resolved but data layer returned null) is indistinguishable from "this org legitimately has zero contributors/repos" — the user gets a header-only CSV and assumes the export worked.
- **Root cause**: `null` (no/failed lookup) and empty-but-valid data are funneled to the same empty-rows path with no distinction.
- **Impact**: Success theater — a broken/empty export looks identical to a real one; no signal to retry.
- **Fix sketch**: Treat a `null` insights/governance result as a 404 (`No analytics for this org yet`) or 503, and reserve the empty-rows 200 for a genuinely empty (non-null) dataset.
