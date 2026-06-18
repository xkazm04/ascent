> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
# Test Mastery — Trends & Comparison

## 1. Pin the `/api/history` org-scoping gate so a name collision can never leak another tenant's history
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/history/route.ts:72-91
- **Scenario**: A refactor of the auth/scoping block — dropping the `isAuthConfigured() && !getSession()` 401, or passing the wrong `orgSlug` (or omitting it) into `getRepositoryHistory` — would let an anonymous or cross-tenant caller read another org's scan history (and its CSV export) for any `owner/repo` slug they can guess. There is **no test anywhere** over this route (`grep` for `api/history`/`historyToCsv` returns NONE), so this silent authorization regression ships green.
- **Root cause**: The entire route handler is untested. The org-scoping (`readableOrgForOwner(parsed.owner)` → `orgSlug` → `getRepositoryHistory({ orgSlug })`) and the auth gate are the only things standing between a public slug and a private tenant's trend data, but no test asserts the gate fires or that the `orgSlug` actually flows into the query.
- **Impact**: Cross-tenant data leak of private repo maturity history — a security/data-integrity breach on a multi-tenant SaaS, exactly the class of bug the comment block on lines 67-74 was written to prevent.
- **Fix sketch**: Add `route.test.ts` mocking `@/lib/auth` and `@/lib/db`. Assert: (a) auth configured + no session → `401` and `getRepositoryHistory` is **never called**; (b) a session whose `readableOrgForOwner` resolves to org "acme" calls `getRepositoryHistory(owner, repo, { orgSlug: "acme" })` — assert the `orgSlug` argument, not just a 200; (c) DB unconfigured → `503`; (d) missing/invalid `repo` → `400`. Invariant: the response body for org A must be reachable **only** through org A's resolved slug.

## 2. Test `parseRepositoryHistory` — the trust boundary that keeps a drifted /api/history body from white-screening the trend charts
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/report/validate.ts:114-146
- **Scenario**: Someone "simplifies" `parseRepositoryHistory` (e.g. removes the `Number.isNaN(Date.parse(s.scannedAt))` guard, or stops dropping points with a non-numeric `overallScore`) and a malformed/drifted history row now flows into `DimensionTrends` → `withinRange`/`forecastTrajectory`/`TrendChart`, where a non-numeric score or unparseable date produces a NaN SVG coordinate or a thrown `.map` and **white-screens the entire trends page**. `validate.ts` has **no test file** at all — the module-doc invariant ("NEVER throw — always return a well-formed object, dropping any point that can't be coerced") is asserted nowhere.
- **Root cause**: The validator was written specifically as the asymmetric counterpart to `parseScanReport` (per its own comment) but never got a test, so its core contract is undefended.
- **Impact**: Client-render crash for any user on the /trends page whenever the DB/history shape drifts or a corrupt row exists — the validator's whole reason to exist, silently regressible.
- **Fix sketch**: Add `validate.test.ts`. For `parseRepositoryHistory` assert invariants on junk: `parseRepositoryHistory(null)` / `{}` / `{scans:"x"}` → `{ repo:{owner:"",…}, scans:[] }` (never throws); a mixed array where one point has `overallScore:"40"` (string), one has `scannedAt:"not-a-date"`, one is valid → only the valid point survives and every surviving point has a finite `overallScore` and a `Date.parse`-able `scannedAt`; a dimension entry missing `score` is dropped from that point's `dimensions`. Add a couple of `parseScanReport` failure cases too (missing `repo`, non-array `dimensions`) asserting `{ ok:false }` with a message, not a throw.

## 3. Cover the /api/history CSV export for cell-shifting commas, header injection, and formula injection
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/app/api/history/route.ts:19-48
- **Scenario**: The CSV path is the "show my boss / pull into a spreadsheet" artifact, and three regressions ship silently today: (a) a refactor of `csvField` that stops quoting a value containing a comma (e.g. a comma'd locale timestamp) shifts every downstream column and **misaligns the whole export** — the exact bug the line-37 comment says was fixed; (b) `safeFilenameSlug` regressing its `[^a-z0-9-]` strip would let a crafted repo full-name inject CRLF/quotes into the `Content-Disposition` header (response-splitting / filename spoofing); (c) `csvField` does **not** neutralize spreadsheet formula-injection prefixes (`=`, `+`, `-`, `@`) — a repo/engine string starting with `=` becomes a live formula when the "boss" opens the CSV in Excel. None of `csvField`/`historyToCsv`/`safeFilenameSlug` has any test.
- **Root cause**: All three helpers are pure and trivially testable but untested; the column-alignment and filename-sanitization invariants live only in code comments.
- **Impact**: Corrupted/misaligned exec-facing exports (data-integrity), a header-injection vector, and a CSV-formula-injection vector in a download handed to a non-technical stakeholder.
- **Fix sketch**: Unit-test the helpers (export them or test via the route). Invariants: `csvField("a,b")` → `"a,b"` quoted; `csvField('he"llo')` → doubled quotes; `historyToCsv` over a row whose `level` contains a comma keeps every row's field count equal to the header's (split each line on top-level commas, assert equal length); `safeFilenameSlug("a/b\r\nx\"")` contains no `/`, CR, LF, or `"`. Decide-and-pin the formula-injection policy: if values should be prefixed (e.g. `'`) when starting with `= + - @`, add `csvField("=cmd")` → leading-quote assertion; if intentionally not, document it and assert the current behavior so the decision is explicit, not accidental.

## 4. Add a regression-direction and LLM-attribution test to `diffScans` so the "What changed" story can't silently flip
- **Severity**: Medium
- **Category**: error-branch
- **File**: src/lib/report/compare.ts:179-204, 282-288
- **Scenario**: `compare.test.ts` only exercises an *improving* diff (everything goes up) and the no-evidence `buildAttribution` LLM-judgment branch (lines 194-200) and the *regression* direction (after older/worse than before) are never asserted. A refactor could (a) break the "score moved but no signals changed → attribute to LLM judgment" line so it silently emits an empty or misleading attribution, or (b) invert a `delta`/`up` sign so a regression renders as green progress. Also untested: `recsMovedToDone` correctly **excludes** an item already `done` in `before` (line 286) — a wrong match here marks an old completion as newly-done.
- **Root cause**: The single `diffScans` happy-path test asserts the optimistic narrative; the failure-direction and the judgment-only attribution branch — the parts that decide whether a user sees "you regressed" honestly — are uncovered.
- **Impact**: A maturity report could show false progress (or hide a regression / double-count a completed rec), eroding trust in the core comparison product.
- **Fix sketch**: Add cases: (a) `diffScans(better, worse)` → `overall.delta < 0`, `level.up === false`, the regressed dimension's `attribution` starts with `"D# -N"`; (b) a dimension whose `score` moves but whose `evidence`/`gaps` are identical → `attribution` ends with `"assessment shifted (no change in detected signals)"` (or the signalDelta variant when `signalScore` alone moved); (c) a rec `done` in **both** scans → it is **absent** from `recsMovedToDone`, while a rec that was `open`→`done` is present.

## 5. Unit-test `withinRange` for the range-toggle edge cases (NaN date keep-rule, boundary, empty)
- **Severity**: Low
- **Category**: edge-case
- **File**: src/components/report/DimensionTrendsRange.tsx:15-22
- **Scenario**: `withinRange` slices the scan list before any chart maps it, and its deliberate "keep a scan whose `scannedAt` is unparseable" rule (line 20) plus the `days===null` (All) passthrough are untested. A refactor that flips the NaN branch to *drop* unparseable points, or an off-by-one at the `t >= cutoff` boundary, would silently change which scans appear in the 5d/30d/90d toggle — and the header's "N scans shown" count derived from it — with no test catching it.
- **Root cause**: Pure, time-window function with a non-obvious keep-on-NaN contract; no test file for the range module.
- **Impact**: Low (cosmetic/range-display drift), but cheap to lock and prevents a confusing "wrong number of scans" UX regression.
- **Fix sketch**: Add a small test (inject a fixed `Date.now` or use relative offsets): `withinRange(scans, null)` returns the input unchanged; a scan exactly at the cutoff is kept (`>=`); a scan with `scannedAt:"garbage"` is **kept** (Number.isNaN branch); newest-first order is preserved. Invariant: only points strictly older than the window are dropped, and an unplaceable date is never silently filtered out here (that's `parseRepositoryHistory`'s job upstream).
