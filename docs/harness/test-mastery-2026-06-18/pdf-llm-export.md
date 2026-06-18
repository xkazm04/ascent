> Total: 5 findings (2 critical, 1 high, 1 medium, 1 low)

# Test Mastery — PDF & LLM Export

The three files in this context ship with **zero** tests: `src/app/api/report/pdf/route.ts`, `src/lib/pdf/report-document.tsx`, and `src/components/CopyForLlm.tsx`. The PDF route is the "PDF export" sold on the Private tier and is a tenant-data egress point — its auth gating is a money/security path with no test at all. The findings below are ranked by business blast radius, not line count.

## 1. Pin the cross-tenant authorization gate on the PDF export route
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/report/pdf/route.ts:34-47
- **Scenario**: A non-member requests `GET /api/report/pdf?repo=acme/private-repo`. Today three things keep that from leaking: (a) `readableOrgForOwner(owner)` returns `"public"` for a non-member (auth.ts:332-336), (b) `requireOrgRead(orgSlug)` returns a 401/403 when the resolved org isn't readable, and (c) the **same** `orgSlug` is threaded into `getScanReportByCommit(..., { orgSlug })` so the data fetch is scoped to the gated org. A refactor that fetches with `DEFAULT_ORG_SLUG`/the real owner instead of the gated `orgSlug`, drops the `requireOrgRead` call, or moves the fetch above the gate would silently turn every private report's PDF into an unauthenticated download — and no test would go red.
- **Root cause**: The route has no `.test.ts`. The whole gate-then-fetch sequence (the security contract that the *gated* org equals the *fetched* org) lives only in prose comments, not an assertion.
- **Impact**: Cross-tenant leak of a private customer's full maturity report (scores, risks, contributors) as a polished, shareable PDF — the worst-case form of the report IDOR the read-gate exists to close, on a paid-tier surface.
- **Fix sketch**: Add `route.test.ts` mocking `@/lib/auth` (`readableOrgForOwner`), `@/lib/authz` (`requireOrgRead`), and `@/lib/db` (`getScanReportByCommit`, `isDbConfigured`), following the `src/app/api/scan/route.test.ts` mock-the-boundaries pattern. Assert: (1) when `requireOrgRead` returns a Response, the handler returns it **and `getScanReportByCommit` is never called** (no fetch behind a closed gate); (2) the `orgSlug` passed to `getScanReportByCommit` is the **exact value** returned by `readableOrgForOwner` (capture the mock's call arg and `expect(...).toBe(resolvedOrg)`) — this is the invariant that prevents a default-org fetch from bypassing the gate; (3) a non-member path (`readableOrgForOwner→"public"`, repo not under public) yields 404, not a PDF.

## 2. Cover the PDF route's failure branches (no-DB, bad input, missing scan, render failure)
- **Severity**: Critical
- **Category**: error-branch
- **File**: src/app/api/report/pdf/route.ts:28-32, 39-47, 53-60
- **Scenario**: The route has five guarded failure exits — 503 (`!isDbConfigured`), 400 (missing `?repo`), 400 (`parseRepo` returns null), 404 (no saved scan), and 500 (`renderToBuffer` throws). The 500 branch exists specifically so a malformed report field or a `@react-pdf` edge case "must not escape as an unhandled 500 with a raw stack." None of these branches is exercised. A change that lets `renderToBuffer` reject without the try/catch, or returns the report on a missing-scan path, would regress the contract silently; worse, the 404-vs-leak distinction (`getScanReportByCommit` resolves `null` → 404) is the *only* signal that distinguishes "no data" from "wrong tenant," and it's untested.
- **Root cause**: No test file; the status-code contract for each guard is asserted nowhere, so error handling can rot without a red test.
- **Impact**: A regressed error path either crashes the export (raw stack / 500 with internals) or, on the 404 branch, blurs the wrong-tenant boundary — both on a paid feature where a broken export erodes trust in the tier.
- **Fix sketch**: In the same `route.test.ts`, table-drive the guards: `isDbConfigured→false` ⇒ 503; missing `repo` ⇒ 400; `repo=foo` (no slash) and `repo=foo/` ⇒ 400; `getScanReportByCommit→null` ⇒ 404 (and assert body is the "Scan it first" message, not a report); `renderToBuffer` rejects ⇒ 500 with `{ error: "Failed to render the PDF." }` and **no stack/internal detail in the body**. Assert `content-type` is `application/pdf` only on the success path.

## 3. Assert the Content-Disposition filename sanitization actually neutralizes header/path injection
- **Severity**: High
- **Category**: success-theater
- **File**: src/app/api/report/pdf/route.ts:64-69
- **Scenario**: The `sha` segment is "caller-supplied and unvalidated," and the code sanitizes it with `s.replace(/[^A-Za-z0-9._-]/g, "-")` before interpolating into the `content-disposition` header. The defense is real but unproven: a regression that loosens the character class (e.g. allows `"`, `\r`, `\n`, `/`, or `;`) would enable response-header injection or a path-traversal-style filename, and nothing would catch it. The function is a pure string transform — the cheapest possible thing to pin, yet it's the security control on a header derived from user input.
- **Root cause**: The sanitizer is an inline arrow (`safe`) with no test; its allowlist invariant is asserted only in a comment.
- **Impact**: If the allowlist is widened in a future edit, an attacker-controlled `@sha` could inject CRLF/extra header directives or `filename="../../evil"` into the download — header smuggling on a tenant-data response.
- **Fix sketch**: Extract `safe`/`parseRepo` into a tiny pure module (or test via the route by capturing the `content-disposition` header), then assert the invariant directly: for inputs containing `"`, `\r\n`, `;`, `/`, `\`, spaces, and unicode, the resulting filename matches `/^ascent-[A-Za-z0-9._-]+\.pdf$/` and contains no `"`, CR, LF, or `/`. Also pin `parseRepo`: `owner/name@sha` splits correctly, `name` with embedded `/` keeps everything after the first slash, leading/trailing-slash inputs return `null`, and a trailing `@` yields `sha === undefined`.

## 4. Pin the PDF document's score-band and conditional-section rendering (no render crash on edge reports)
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/pdf/report-document.tsx:15-20, 88-114, 54
- **Scenario**: `scoreColor(score)` drives the headline number, the three axis values, and every dimension row via four bands (≥80 green, ≥60 accent, ≥40 amber, else red). The header date does `new Date(report.scannedAt).toISOString()` — an invalid/absent `scannedAt` produces `Invalid Date` and `.toISOString()` **throws**, which surfaces as the route's opaque 500. The Strengths/Risks block is conditionally rendered only when at least one array is non-empty. None of this branch logic is covered; a band boundary slipping by one (e.g. `> 80` instead of `>= 80`) or a date-guard regression would either miscolor every PDF or crash the export for a report missing a timestamp.
- **Root cause**: The document is an untested `.tsx`; `scoreColor` is a pure function trivially unit-testable but lives un-exported inside the component module.
- **Impact**: Wrong color bands mislead readers of a leadership-facing export; a `scannedAt` edge case crashes the paid export entirely (500). Low-frequency but real on backfilled/legacy scans.
- **Fix sketch**: Export `scoreColor` (or test it directly) and assert the four band boundaries at the exact edges: `scoreColor(79.9)`, `80`, `59.9`, `60`, `39.9`, `40`, `0`, `100`. Add a render-smoke test via `@react-pdf/renderer`'s `renderToBuffer(<ReportDocument report={fixture}/>)` for three fixtures — empty strengths+risks (section omitted), a report with `scannedAt` undefined and a malformed string (must not throw), and a full report — asserting the call resolves to a non-empty `Buffer`. The invariant: a structurally-valid `ScanReport` never throws during render regardless of empty arrays or a missing date.

## 5. Cover CopyForLlm's clipboard fallback and state machine without coupling to the DOM render
- **Severity**: Low
- **Category**: coverage-gap
- **File**: src/components/CopyForLlm.tsx:22-41, 64-78
- **Scenario**: `copy()` tries `navigator.clipboard.writeText`, and on any throw or when the API is absent falls back to `legacyCopy` (textarea + `execCommand`), then sets a `copied`/`failed` state that auto-resets on a timer. The "secure-context fails → legacy succeeds → shows Copied" path and the "both fail → shows Copy failed" path are the only logic worth protecting (the button copying *something* is the whole point of the LLM-export direction). With no jsdom/testing-library in this repo, a React render test is the wrong tool, so the fallback/decision logic should be extracted and unit-tested.
- **Root cause**: The copy decision logic is entangled with component state inside an un-extracted closure; there's no jsdom env, so it currently can't be tested at all.
- **Impact**: A clipboard-fallback regression makes "Copy for LLM" silently no-op on http/older browsers across reports, briefings, security and governance pages — the export quietly breaks with the button still flashing "Copied."
- **Fix sketch**: Extract a pure `async function attemptCopy(text, clipboard, legacy): Promise<boolean>` taking the clipboard API and the legacy fn as injected deps. Unit-test: clipboard present + resolves ⇒ `true`, legacy not called; clipboard present + rejects ⇒ falls through to legacy, returns legacy's result; clipboard absent ⇒ legacy invoked with the exact `text`; both fail ⇒ `false`. Cover DOM-bound behavior (focus/select/state reset) with a Playwright e2e instead of a render test.
