> Total: 6 findings (2 critical, 2 high, 1 medium, 1 low)
# Test Mastery — Scan Pipeline & Ingestion

The scan pipeline is the product's front door and its only money meter on the free/public surface. What is tested today is narrow and deliberate: `scan.test.ts` covers SHA-drift threading (3 tests, mock source); `scan-cache.test.ts` covers `resolveHeadWithHint` ETag reuse (4 tests); `cache.test.ts` covers `coalesceScan` refcounted abort (3 tests); and both route `.test.ts` files cover exactly one thing each — the degrade-to-mock cache-poisoning guard, with every dependency mocked. The billing ledger that wraps both routes (quota slots, prepaid credits, dedup/degrade/throw refunds) has **zero tests**, and the LLM resilience/usage-capture core of `scan.ts` is untested for the failure branches that protect both correctness and revenue. Findings are ranked by business blast radius.

## 1. Test the quota+credit refund ledger in /api/scan for the no-billable-product paths
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/scan/route.ts:128-242 (`refundQuota`, `refundCredit`, `degradedToMock`, `deduped`, `lowCoverage`, throw path)
- **Scenario**: A refactor reorders the refund logic so a scan that degrades to mock, dedups an already-scored commit, or throws (typo/404/abort) still consumes a weekly free slot or a prepaid credit — OR the inverse: a real, newly-scored metered scan double-refunds and is served free. The existing `route.test.ts` mocks `@/lib/db` to `isDbConfigured: () => false`, so the entire credit-and-quota block never executes in any test; nothing fails.
- **Root cause**: The only route test asserts `cacheSet` call shape under a DB-less config. `consumeScanCredit`, `grantCredits`, `consumePublicScanQuota`, `refundPublicScanQuota`, `checkScanEntitlement`, and `maybeAlertLowCredits` are never wired with the DB on, so the reserve-before-inference and refund-on-no-product invariants are pure narrative comments with no executable check.
- **Impact**: Direct revenue leak (paid scans served free) or customer-trust damage (charged for a degraded mock / dedup / a mistyped URL). This is the single highest-blast-radius gap in the context.
- **Fix sketch**: Add a route integration test with `@/lib/db`/`@/lib/entitlement`/`@/lib/public-scan-quota` mocked and DB on. Drive a metered org (`resolveScanAuth` → non-public orgSlug) and assert: (a) `degradedToMock` → exactly one `grantCredits(orgSlug,1,{reason:"refund"})` AND one `refundPublicScanQuota`; (b) `deduped` → one credit refund; (c) `scanRepository` throws → both refunds fire; (d) a real LLM, newly-scored, non-dedup metered scan → **no** refund and `consumeScanCredit` called once. Invariant: net credits debited == 1 iff a new, non-mock, non-dedup, ≥0.5-coverage report was produced — and exactly 0 otherwise.

## 2. Test scan.ts usage capture so a failed LLM attempt never bills the user
- **Severity**: Critical
- **Category**: success-theater
- **File**: src/lib/scan.ts:204-219 (`attemptAssess` / `capturedUsage`) and 273-296 (degrade-to-mock)
- **Scenario**: A provider calls `onUsage` before the parse/usability check (as the comment documents). A primary attempt returns an unusable assessment (empty `{}` / all-unknown dimensions), the scan retries/fails over or degrades to mock — but `report.usage` still carries the failed attempt's tokens. That token usage is the metering basis persisted on the Scan row. The lone `scan.test.ts` only exercises SHA threading with `mock:true`, so the retry/failover/degrade ladder and the "commit usage only on success" guarantee are never executed.
- **Root cause**: No test injects a fake `LLMProvider` whose `assess` calls `onUsage({inputTokens:…})` and then returns an unusable shape, then succeeds (or degrades). The `isAssessmentUsable` gate, the `LLM_TOTAL_BUDGET_MS` deadline, and the `capturedUsage = attemptUsage` commit-on-success line are entirely uncovered.
- **Impact**: Users billed/metered for inference that never contributed to their report; the deterministic-floor report is presented as if a paid model produced it. Both a money bug and a trust bug.
- **Fix sketch**: Inject a stub provider (via `opts.source` is not enough — pass a forced provider through env or a fake by stubbing `getProvider`/`providerByName`). Assert: a primary attempt that reports usage then throws/returns-unusable, followed by a usable retry, yields `report.usage` from the **winning** attempt only; a full degrade-to-mock yields `report.usage` with no input/output tokens (cost 0) and `report.engine.provider === "mock"`. Invariant: `report.usage` tokens equal exactly the tokens of the attempt whose assessment was accepted, and are empty when the scan degraded to mock.

## 3. Test the isAssessmentUsable degrade gate flags llmFailed + warning (anti-success-theater)
- **Severity**: High
- **Category**: error-branch
- **File**: src/lib/scan.ts:212-216, 278-291, 321-325 (`isAssessmentUsable`, `llmFailed`, warnings push)
- **Scenario**: A provider returns a parseable-but-empty assessment for a real (non-mock) scan. The intended behavior is: treat it as a failure, exhaust retry/failover, degrade to mock, set `llmFailed = true`, and append the "AI analysis was unavailable…" warning so the score is read as deterministic-only. A regression that loosens `isAssessmentUsable` (or drops the `llmFailed` warning) would silently render the deterministic floor under "Scored with gemini" with no caveat — the exact success-theater this code was written to prevent. No test asserts the warning is present.
- **Root cause**: The whole gate path is only reachable with a non-mock provider that returns a bad shape; `scan.test.ts` never constructs one, and the route tests mock `scanRepository` wholesale.
- **Impact**: Users (and the CI gate / badge downstream) trust a low-confidence deterministic score as an AI-audited one. Erodes the core "scores stay honest" promise.
- **Fix sketch**: With a stub provider returning `{dimensions: []}` and no configured fallback, assert `report.engine.provider === "mock"`, `report.warnings` includes the "AI analysis was unavailable" sentence, and a usable assessment does **not** add it. Invariant: a non-mock report whose effective engine is mock MUST carry the llmFailed warning; a genuinely AI-scored report MUST NOT.

## 4. Test resolveScanAuth's authorize-before-mint cross-tenant gate
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/scan.ts:77-102 (`resolveScanAuth`)
- **Scenario**: A regression drops the `sessionHasInstallation` / `sessionOwnsOrg` check (or evaluates `authOn` wrong), letting an anonymous caller pass another tenant's enumerable `installationId` — or rely on the repo owner's stored installation — to mint that installation's token and read a **private** repo's maturity (cross-tenant IDOR). This is the security boundary that decides whether a private scan is authorized; it has no test.
- **Root cause**: The function is exported and pure-ish (only its `sessionHas*`/`getInstallationIdForOwner`/`getInstallationToken` deps need mocking), but no test drives the four branches: caller-supplied id that does/doesn't belong to the session, owner-stored id when the caller does/doesn't own the org, and auth-off (local/demo) staying open.
- **Impact**: Silent private-repo data exposure across tenants — the highest-severity class for a multi-tenant SaaS, even if "only" a maturity snapshot.
- **Fix sketch**: Mock the auth deps; with `isAppConfigured()` and `isAuthConfigured()` true assert: a supplied `installationId` not owned by the session → `{orgSlug:"public"}` (no token); a supplied id the session has → token minted for it; no id but `sessionOwnsOrg(owner)` true → owner's stored id used; auth-off → owner's stored id used without a session check. Invariant: a token is minted ONLY when the session is authorized for that installation/org (or auth is disabled), never on an unauthorized caller-supplied or owner-stored id.

## 5. Test makeCacheKey/normalizeRepoName collapse casing and percent-encoding to one key
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/cache.ts:25-59 (`normalizeRepoName`, `makeCacheKey`)
- **Scenario**: A regression to the trim/decode/lowercase order (or the `@sha::mode` assembly) makes `Facebook/React`, `facebook/react`, and `facebook%2Freact` key different cache entries, or a malformed `%xx` escape throws instead of falling back to the raw value. The module comment warns this exact drift lets a README badge keep serving a stale mock level after a real LLM scan exists — but there's no test for it.
- **Root cause**: These are the cache-identity invariant for the whole pipeline (routes, badge, gate all key through them) yet have no unit test. They are pure, deterministic functions — the cheapest possible coverage with a real invariant.
- **Impact**: Cache fragmentation → duplicate GitHub/LLM spend and stale/inconsistent reports across surfaces (badge vs report vs gate disagree on the same commit).
- **Fix sketch**: LLM-generatable table-test: assert `makeCacheKey` produces the identical string for casing/encoding/whitespace variants of the same owner/repo at the same sha+mode; that a `sha` pins `@<lowercased-sha>` and `null`/omitted falls back to the un-pinned form; that `useLLM` toggles `::llm` vs `::mock`; and that `normalizeRepoName("%ZZ")` returns the trimmed raw value (no throw). Invariant: one logical repo+commit+mode ⇒ exactly one cache key, idempotent under re-normalization.

## 6. Test parseSSE/readSSE frame parsing — the live-result delivery primitive
- **Severity**: Low
- **Category**: coverage-gap
- **File**: src/lib/sse.ts:13-51 (`parseSSE`, `readSSE`)
- **Scenario**: A change to the `\n\n` framing, the `slice(6)/slice(5)` offsets, the multi-line `data:` concatenation, or the keepalive-skip (`if (msg.event || msg.data)`) silently drops or corrupts the terminal `result` frame, so a finished scan never lands on the report and the user sees a perpetual spinner. These pure browser-safe helpers carry every SSE consumer's payload yet have no test.
- **Root cause**: No `sse.test.ts` exists. The functions are pure and trivially testable (a `parseSSE` string in, a `ReadableStream` of chunked bytes for `readSSE`), so the gap is pure omission.
- **Impact**: Live-scan UX breakage (stuck progress / lost result) that unit tests would catch instantly; low money blast radius but high visibility on the primary funnel.
- **Fix sketch**: `parseSSE`: assert a well-formed `event:`/`data:` block parses to name+JSON; a `: ping` keepalive yields `{event:null,data:null}`; malformed JSON yields `data:null` (no throw); multiple `data:` lines concatenate. `readSSE`: feed a stream that splits a frame across two chunks and assert `onMessage` fires once with the reassembled frame and that empty keepalive frames are skipped. Invariant: every non-empty `\n\n`-delimited frame is delivered exactly once with its payload intact regardless of chunk boundaries.
