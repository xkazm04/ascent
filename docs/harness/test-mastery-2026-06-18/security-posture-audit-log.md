> Total: 5 findings (2 critical, 2 high, 1 medium)

# Test Mastery — Security Posture & Audit Log

This context is the org's security view (D9 posture + supply-chain advisories) and the **immutable audit log** that compliance customers rely on to prove "who did what". The two existing test files cover only the two *pure string/tally helpers* (`securityMarkdown`, `countAdvisories`) — every function that touches authorization, the DB, the security gate verdict, or the CSV compliance export is **untested**. The risk lives exactly one layer above where the tests stop.

---

## 1. Test the audit-log read path: org-scoping, keyset pagination, and scan enrichment

- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/db/scans-audit.ts:112 (`getAuditLog`) — no test file exists (`scans-audit.test.ts` absent)
- **Scenario**: A refactor of the keyset `where.OR` clause (line 133: `[{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }]`) drops the `id` tie-breaker, or the `orderBy` flips to `asc`, or the `where.orgId` filter (line 123) is accidentally widened. Any of these ships silently: pagination starts **dropping or duplicating** audit rows at page boundaries where `at` ties, or — worst case — the org filter regresses and **one tenant's audit trail leaks into another's**. The module comment claims "Org-scoped: only entries for `orgSlug` are returned" but nothing asserts it.
- **Root cause**: `getAuditLog` is mocked away in every consumer test (audit page, AuditLogViewer) and has no direct test. The cursor round-trip (`encodeAuditCursor`/`decodeAuditCursor`, lines 89-104) and the composite-key tie-break are pure logic that is trivially testable against a seeded Prisma test DB but never exercised.
- **Impact**: Cross-tenant audit-log leakage (a compliance/security incident) or gap-free pagination breaking the legal record — both are the exact failure this feature exists to prevent.
- **Fix sketch**: Add `scans-audit.test.ts` against the better-sqlite3/Prisma test DB. Seed two orgs with audit rows sharing identical `at` timestamps. Assert: (a) `getAuditLog("orgA")` returns **only** orgA rows (invariant: every `entry` belongs to the queried org); (b) paging with `limit:1` through `nextCursor` visits **each row exactly once, newest-first, no dupes/gaps** even across the `at`-tie; (c) a malformed/forged cursor (`decodeAuditCursor` returns null) restarts from page 1 rather than throwing; (d) `since`/`until` boundaries filter inclusively (`gte`/`lte`).

## 2. Test that audit reads are authorization-gated against cross-tenant access

- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/audit/route.ts:81 (`requireOrgRead(org)` gate) — route has no test (`src/app/api/audit/` contains only `route.ts`)
- **Scenario**: The `const denied = await requireOrgRead(org); if (denied) return denied;` gate (lines 81-82) is reordered below the CSV branch, or someone "simplifies" it away during a refactor, or the CSV export path (line 91-93) is later given its own entry point that forgets the gate. The route then serves **any org's full audit trail — including the CSV bulk export — to an unauthenticated or non-member caller**. The route comment asserts "no cross-tenant entries can leak", but no test pins that the gate runs *before* `getAuditLog` *on both the JSON and CSV branches*.
- **Root cause**: No route test exists. `requireOrgRead` itself has unit coverage in `authz.test.ts`, but the *wiring* — that the audit handler actually calls it, returns its 401/403 verbatim, and short-circuits before any DB read — is the untested integration that a regression would slip through.
- **Impact**: IDOR on the audit log = anyone can read who-did-what across every tenant. Highest-blast-radius failure in this context.
- **Fix sketch**: Add `route.test.ts` mocking `@/lib/authz` and `@/lib/db`. Invariant: when `requireOrgRead` returns a 403 Response, the handler returns **exactly that** and `getAuditLog` is **never called** — assert `getAuditLog` mock `.not.toHaveBeenCalled()` for **both** `?format=csv` and the default JSON request. Also assert the 503 (`isDbConfigured()===false`) and 400 (missing `org`) short-circuits fire before the gate/DB.

## 3. Test `buildSecurityOverview` gate verdict and band classification for failure, not just the markdown

- **Severity**: High
- **Category**: success-theater
- **File**: src/lib/org/security.ts:34 (`buildSecurityOverview`); existing test src/lib/org/security.test.ts only feeds a hand-built fixture into `securityMarkdown`
- **Scenario**: The failing-repo predicate (line 70: `r.score < minSecurity || r.posture === "ungoverned"`) is the security gate verdict the Security tab shows and the brief tells an LLM to remediate. A regression — e.g. flipping `<` to `<=`, dropping the `posture === "ungoverned"` arm, or a band-boundary off-by-one (lines 60-63: `<40`/`<60`/`<80`) — would misreport which repos **fail security**, and `security.test.ts` would stay green because it never calls `buildSecurityOverview`; it only checks the pre-computed fixture's string rendering. This is textbook success-theater: the suite tests the *formatter*, not the *judgment*.
- **Root cause**: `buildSecurityOverview` reads `getOrgRollup`/`getOrgGovernance` (mockable) and the test author stopped at the pure markdown helper, leaving the band math and gate predicate — the actual business logic — uncovered.
- **Impact**: A repo that should FAIL the security gate is shown as passing (or vice-versa), so a genuinely insecure repo is greenlit, or a healthy one is flagged — directly undermining the security posture the tab is sold on.
- **Fix sketch**: In `security.test.ts`, mock `@/lib/db` `getOrgRollup`/`getOrgGovernance`. Feed repos straddling each boundary: D9 = 39/40 (critical→weak), 59/60, 79/80, and one `posture: "ungoverned"` with D9=90. Assert the invariants: band counts match the `<40/<60/<80/else` buckets; a repo at exactly `minSecurity` (DEFAULT_SECURITY_MIN) **passes** (predicate is strict `<`); the ungoverned-but-high-score repo appears in `securityGate.failing` with `reason === "ungoverned posture"`; `passing + failing === scanned`; and `null` is returned when `rollup.scannedCount === 0`.

## 4. Test the supply-chain provider's quiet-degradation and demo-honesty path

- **Severity**: High
- **Category**: error-branch
- **File**: src/lib/security/supply-chain.ts:63 (`githubProvider.fetchAdvisories`) and :112 (`getOrgSupplyChain`); existing test only covers `countAdvisories`
- **Scenario**: `fetchAdvisories` must return **null** (not zeros) on a 403/404/throw (lines 72, 75) so a permission-less or erroring repo is *excluded* rather than reported as "0 advisories — clean". A regression that returns `{...EMPTY}` on `!res.ok` would make every repo look secure when Dependabot access is actually denied — the most dangerous possible false signal in a security tool. Equally, `demo: provider.name === "mock"` (line 145) is the **honesty flag** the UI uses to label demo data; if it regresses to always-false, demo numbers are presented as live security facts. None of this is tested.
- **Root cause**: The test mocks `fetch` away entirely and asserts only the pure tally. The provider's HTTP error-branch (the trust boundary the module comment calls out) and the `getOrgSupplyChain` aggregation/sort/`demo` assembly are untested.
- **Impact**: Repos with denied/failed advisory fetches silently render as "0 vulnerabilities," or demo data is shown as real — a security dashboard lying about supply-chain risk.
- **Fix sketch**: Unit-test `fetchAdvisories` with a stubbed `fetch`: assert `res.ok=false` (403 and 404) → `null`; a thrown fetch → `null`; non-array JSON → `{...EMPTY}` (the explicit fallback at line 74); a valid array → tallied counts. Test `getOrgSupplyChain` (mock `getOrgRollup`/pool/provider) for the invariants: rows where `fetchAdvisories` returned null are **dropped** from `scanned`/`repos`; `totals` equals the sum of kept rows; `repos` is sorted critical-desc then high-desc; and `demo===true` **iff** `SUPPLY_CHAIN_PROVIDER=mock`. Also assert `selectProvider()` returns null when the env var is unset/`off`.

## 5. Test the audit CSV export for formula-injection neutralization and `until`-boundary integrity

- **Severity**: Medium
- **Category**: edge-case
- **File**: src/app/api/audit/route.ts:18 (`csvCell`) and :27 (`exportCsv`)
- **Scenario**: `csvCell` (lines 18-21) does RFC-4180 quote-escaping but does **not** neutralize spreadsheet **formula injection**: an `action`, `actorId`, or `meta` value beginning with `=`, `+`, `-`, `@`, or a leading tab/CR is evaluated as a formula when the "compliance evidence" CSV is opened in Excel/Sheets (e.g. `=HYPERLINK(...)` for data exfiltration). Since `action` is free-text written by `recordAudit` callers and `meta` is attacker-influencable JSON, a crafted audit row turns the export into a live formula. Separately, the export loops `getAuditLog` (line 35) but there is no test that the `until` filter and the `CSV_MAX_ROWS` cap (line 24) actually bound the loop, nor that `meta` is emitted as valid escaped JSON.
- **Root cause**: No test exercises `csvCell` or `exportCsv`; the escaping logic looks correct for quotes, so the missing formula-injection guard goes unnoticed.
- **Fix sketch**: Unit-test `csvCell` (export it or test via the route) asserting the invariant: any value whose first char is in `=+-@`/tab/CR is prefixed with a guard (`'` or a leading space) **and** quote-wrapped, so the rendered cell cannot start a formula; plain values round-trip unchanged; embedded `"` is doubled; embedded newline stays inside the quoted field. Then a small `exportCsv` test (mock `getAuditLog` to page twice then null) asserting: header row present, one CSV line per entry, `meta` is parseable JSON after CSV-unescaping, and the loop stops at `nextCursor===null` (and would stop at `CSV_MAX_ROWS`).
