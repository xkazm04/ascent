# Code Refactor — Security Posture & Audit Log
> Context group: Org Dashboard & Analytics
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

## 1. CSV escaping / formula-injection helper duplicated across 4 API routes — and already drifting
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/audit/route.ts:25-29 (siblings: src/app/api/org/export/route.ts:14-24, src/app/api/history/route.ts:25-35, src/app/api/org/repositories/route.ts:14-22)
- **Scenario**: `audit/route.ts` defines a `csvCell()` that RFC-4180-quotes a value and prefixes a `=/+/-/@`-leading cell with `'` to neutralize spreadsheet formula injection. Three other routes hand-roll the same helper under the name `csvField()`. There is no shared CSV module anywhere in `src/lib` (confirmed: no `src/lib/**/csv*.ts`). The four copies have already drifted in two ways: (a) `audit`'s `csvCell` ALWAYS wraps every field in quotes, while the other three only quote when the value contains `,`/`"`/`\n`; (b) most importantly, `org/repositories/route.ts:14-22` `csvField` does NOT neutralize formula injection at all — it only quotes on comma/quote/newline, missing the `=/+/-/@` guard the other three implement.
- **Root cause**: Each CSV-export endpoint was built by copy-pasting the escaping helper into its own route file rather than importing a shared one. As new export routes were added, the formula-injection guard was added to some copies but forgotten in `org/repositories`.
- **Impact**: Four copies of a security-sensitive escaping function mean a fix or hardening (e.g. the formula-injection neutralizer) must be applied in four places; the `org/repositories` copy is already a live gap (formula injection not neutralized in that export). High maintenance cost and a real correctness/security divergence that a single source of truth would prevent.
- **Fix sketch**: Extract one canonical helper into a new `src/lib/csv.ts` — e.g. `export function csvField(v: unknown): string` that is total over `unknown` (try/catch `String(v)`), quotes on `,`/`"`/`\n`, doubles embedded quotes, and prefixes `=/+/-/@`-leading cells with `'`. Import it in all four routes and delete the local copies. Behavior-preserving for `org/export`, `history`, and (modulo the harmless always-quote difference) `audit`; it also closes the missing-neutralizer gap in `org/repositories`. The existing per-route CSV tests (`audit/route.test.ts`, `org/export/route.test.ts`, `history/route.test.ts`) pin the expected escaping and should keep passing.

## 2. Filter object built then ignored — non-CSV branch re-reads the same searchParams inline
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/audit/route.ts:96-120
- **Scenario**: `GET` builds a `filters` object from four query params (`action`, `actorId`, `since`, `until`) at lines 96-101 and passes it to `exportCsv` for the `format=csv` branch. The non-CSV branch at lines 112-120 then re-reads the exact same four `searchParams.get(...)` calls inline into the `getAuditLog` query object instead of spreading the already-built `filters`. The four `?? undefined` reads are duplicated verbatim a few lines apart.
- **Root cause**: The `filters` extraction was introduced for the CSV export path; the pre-existing JSON path was left reading params inline, so the two paths now derive the same filter set two different ways.
- **Impact**: A future filter (e.g. a new `repo` param) must be added in two spots; forgetting one silently makes the CSV and JSON responses filter differently for the same query string. Minor, localized, but an avoidable consistency trap in an endpoint whose whole job is faithful filtering.
- **Fix sketch**: In the JSON branch call `getAuditLog(org, { ...filters, cursor: searchParams.get("cursor"), limit: Number(searchParams.get("limit")) || 25 })`, reusing the `filters` object already in scope, and delete the duplicated inline `action`/`actorId`/`since`/`until` reads at lines 114-117. Pure refactor — same values, single source.

## 3. Two divergent window resolvers feed the same SecurityOverview (page vs PDF)
- **Severity**: Low
- **Category**: structure
- **File**: src/app/org/[slug]/security/page.tsx:11,27 vs src/app/api/org/security/pdf/route.ts:14,27
- **Scenario**: The Security page resolves its period with `resolveOrgWindow(sp)` from `@/lib/org/period`, while the sibling PDF route resolves with `resolveWindow({range, from, to})` from `@/lib/window`, then both call `buildSecurityOverview(org, { start, end }, title, …)`. The page also threads `techGroupId` into the overview; the PDF route omits it. The file headers of both the PDF route and `security-document.tsx` claim "page, clipboard, and PDF stay in lockstep," but the period (and tech-stack scope) is resolved by two different code paths.
- **Root cause**: The page predates the PDF route and uses the cookie-aware org-period resolver; the PDF route was modeled on the older briefing-PDF route, which uses the plain `resolveWindow`. The two resolvers were never unified.
- **Impact**: Low — both produce a valid window — but the "lockstep" claim is not fully true: a tech-stack-scoped or cookie-driven period on the page can yield a PDF for a different window/scope than the user is viewing, which is confusing for a board/auditor artifact. Mostly a documentation-vs-reality and minor-consistency concern.
- **Fix sketch**: Out of strict scope to change the resolvers themselves, but the in-scope cleanup is to make the lockstep claim honest: either have the PDF route accept and use the same period/`techGroupId` inputs as the page (pass them through the export URL — the page already builds `?range=&from=&to=`, so add the active tech-group id and resolve via the same helper), or soften the "stay in lockstep" comments in `pdf/route.ts:4-5` and `security-document.tsx:2-4` to note the PDF uses the default period/scope. Prefer the former when the resolver unification is tackled; the latter is the safe, immediate doc fix.
