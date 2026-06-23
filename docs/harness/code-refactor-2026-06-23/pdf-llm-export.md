# Code Refactor — PDF & LLM Export
> Context group: Reporting & Visualization
> Total: 5 findings (Critical: 0, High: 2, Medium: 1, Low: 2)

The five in-scope files are individually clean and well-documented — no dead components, no commented-out blocks, no stray `console.log` (the one `console.error` in pdf/route.ts is intentional error logging). The cruft that exists is *cross-file duplication*: two families of helpers (filename sanitizers and CSV field quoters) have been re-implemented inline in route after route, and one of those families has already drifted into an inconsistency. Findings are ordered by value.

## 1. `csvField` CSV-injection quoter is duplicated across export routes and has already drifted
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/org/export/route.ts:13-24 (in scope); siblings src/app/api/history/route.ts:17-36, src/app/api/org/repositories/route.ts:13-22, src/app/api/audit/route.ts:~20-28
- **Scenario**: The in-scope `csvField` (org/export) quotes per RFC 4180 *and* neutralizes spreadsheet formula injection by prefixing `=`/`+`/`-`/`@` cells with `'`. The same function is re-declared in `history/route.ts` and `audit/route.ts` with the formula guard, but in `org/repositories/route.ts` the re-declared copy is **missing the `/^[=+\-@]/` formula-injection branch entirely** — it only does RFC-4180 quoting. Four near-copies of a security-sensitive helper, one of which has silently diverged.
- **Root cause**: Each CSV export route was written by copy-pasting the previous route's local helper instead of importing a shared one. There is no `src/lib` CSV/export utility module (confirmed: no `csvField`/`safeFilenameSlug` anywhere under `src/lib`), so "copy the helper into the route" became the path of least resistance, and a later edit to the formula guard never propagated to repositories.
- **Impact**: A real latent vulnerability divergence — a hostile contributor/repo name beginning with `=` lands literally in the org-repositories CSV and can execute as a formula in Excel/Sheets, while the byte-identical value is correctly neutralized in the contributors export. Beyond the bug, every future hardening of the quoter must be applied in 3-4 places and is easy to miss again.
- **Fix sketch**: Extract a single `csvField(v: unknown): string` (the formula-guard variant from org/export/history) into a new `src/lib/export/csv.ts`, export it, and replace the four local copies with an import. Behavior-preserving for org/export, history, and audit; for org/repositories it *adds* the missing formula guard (a strict security improvement, still RFC-4180 compatible). While there, lift the shared `toCsv(header, rows)` join helper (org/export:30-32) into the same module since history/repositories build the same `header + rows.map(...)` shape inline.

## 2. Two competing filename-sanitizer helpers re-declared inline in 8 routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/report/pdf/route.ts:64 and src/app/api/org/export/route.ts:26-28 (both in scope); siblings: report/skill/route.ts:56, report/passport/route.ts:27, org/briefing/pdf/route.ts:58 (the `safe` flavor) and usage/route.ts:25, history/route.ts:58, org/repositories/route.ts:25 (the `safeFilenameSlug` flavor)
- **Scenario**: Every download route sanitizes user-influenced segments before the `Content-Disposition` filename, but in two coexisting flavors. The PDF/skill/passport/briefing routes use an inline `const safe = (s) => s.replace(/[^A-Za-z0-9._-]/g, "-")` (preserves case, dots, underscores). The CSV routes use `function safeFilenameSlug(s)` (lowercases, collapses to `[a-z0-9-]`, trims dashes, caps at 80, falls back to a default). Eight inline copies, two subtly different contracts, for one job: "make this header-safe."
- **Root cause**: Same copy-paste-the-local-helper pattern as finding #1, compounded by two authors picking two conventions; neither extracted a shared util, so both propagated independently.
- **Impact**: Maintenance and security-review drag — the header-injection guard is the kind of thing a reviewer wants to audit in one place, not eight. The two flavors also make behavior inconsistent across exports (an `ascent-Owner-Repo.pdf` vs an `ascent-contributors-owner-repo.csv`) for no deliberate reason, which is a latent source of "why is this filename different" confusion.
- **Fix sketch**: Add `src/lib/export/filename.ts` exporting both intents explicitly: `safeFilenameSegment(s)` (the `replace(/[^A-Za-z0-9._-]/g, "-")` form, for the PDF/skill/passport routes that interpolate owner/name/sha) and `safeFilenameSlug(s, fallback = "org")` (the lowercase-collapse form, for the CSV routes). Replace all eight inline declarations with imports. Behavior-preserving when each route adopts the helper matching its current flavor; the `org` vs `repo` fallback difference becomes the explicit `fallback` argument.

## 3. `parseRepo` repo-string parser duplicated between the two report-export routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/report/pdf/route.ts:18-25 (in scope); identical sibling src/app/api/report/passport/route.ts:~16-25
- **Scenario**: The `parseRepo(q)` helper that splits `owner/name[@sha]` (handling the `@sha` suffix and the `owner/`-with-no-name edge cases) is byte-for-byte identical in the PDF export route and the passport export route — both `?repo=owner/name[@sha]` endpoints.
- **Root cause**: The passport route was modeled on the PDF route (same query contract, same gating shape) and the parser was copied along with it rather than shared.
- **Impact**: Two copies of a small but fiddly parser (the `slash <= 0 || slash === base.length - 1` guards are easy to get subtly wrong); a fix or a contract change (e.g. accepting a `#ref`) must be made twice. Low blast radius today, but it is the same drift risk as #1/#2 in miniature.
- **Fix sketch**: Move `parseRepo` (and its `{ owner; name; sha? }` return type) into `src/lib/repo/parse-repo.ts` (or alongside the filename helper in `src/lib/export/`), export it, and import it in both routes. Purely behavior-preserving — the function body is identical.

## 4. `CopyState` type is exported but never consumed outside its own module
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/copy-for-llm.logic.ts:40
- **Scenario**: `export type CopyState = "idle" | "copied" | "failed"` is referenced only within the same file (as the type of `CopyTransition.next`). A repo-wide grep finds no other importer — `CopyForLlm.tsx` consumes `nextCopyState`/`attemptCopy`, never `CopyState`, and the test imports `attemptCopy`, `nextCopyState`, `COPIED_RESET_MS`, `FAILED_RESET_MS` but not `CopyState`.
- **Root cause**: When the pure core was extracted from the inline component, the state union was exported defensively as part of the "public" surface, but no caller ever needed the named type — the component tracks state with two booleans (`copied`/`failed`), not a `CopyState`.
- **Impact**: Minor — an over-broad public surface that implies an external contract that doesn't exist, and one more symbol a reader assumes is used elsewhere. No bundle/runtime cost (type-only).
- **Fix sketch**: Drop the `export` keyword (keep `type CopyState = ...` local to the file so `CopyTransition.next` still resolves). Behavior- and type-preserving. If the intent is a deliberately public API for future consumers, leave it and accept the finding as documentation.

## 5. Redundant `setFailed(false)` reset at the top of `copy()`
- **Severity**: Low
- **Category**: cleanup
- **File**: src/components/CopyForLlm.tsx:26-38
- **Scenario**: `copy()` opens with `setFailed(false)` before awaiting the copy attempt, then in both branches of the result it sets `failed` to its final value (`setFailed(true)` on failure; on success it sets `copied` and leaves `failed` — which the `else` branch's prior auto-reset timer, or this opening line, has already cleared). The opening `setFailed(false)` is a belt-and-suspenders reset that the subsequent branch logic already covers, since a successful copy renders `copied` (which takes visual precedence over `failed` in the className/label ternaries anyway).
- **Root cause**: Defensive state hygiene carried over from the inline-closure version; harmless but slightly muddies the otherwise-clean state machine that was deliberately extracted into `copy-for-llm.logic.ts`.
- **Impact**: Cosmetic only — one extra `setState` per click and a small "why is this here?" for a reader, given the logic was specifically factored out to make the transitions auditable. No bug.
- **Fix sketch**: Optional. Either keep it (it is genuinely harmless and arguably clarifies intent), or remove line 27 and rely on the branch assignments. Listed for completeness; not worth a dedicated change on its own. **This is the weakest finding — fold it into a touch-up only if the file is already being edited.**
