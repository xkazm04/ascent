> Total: 5 findings (2 critical, 2 high, 1 medium)

# Test Mastery — Credits & Entitlements

The pure helpers in this context are well-pinned: `consumeScanCredit`'s post-decrement `balanceAfter` invariant, `grantCredits`'s clamp-and-stamp ledger invariant, `estimateMonthlyCredits`, and the `checkScanEntitlement`/`isMeteredScan` policy all have honest, failure-asserting tests. The gaps are one layer up (the route that actually charges users) and on the two money-movement guarantees the code documents most loudly but never exercises: webhook-redelivery idempotency and the reconciliation classifier.

## 1. Pin the credit reserve / refund / 402 flow in the primary `/api/scan` route
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/scan/route.ts:137-242 (no credit assertions in src/app/api/scan/route.test.ts)
- **Scenario**: A refactor of the single-repo scan front door (the one a paying org actually hits) breaks the metered path: it reserves a credit but the `deduped`/`degradedToMock`/throw refund stops firing, so an org is billed for an unchanged-commit re-scan or a Gemini-timeout mock floor. Or the reverse — the reserve is skipped and `INSUFFICIENT_CREDITS` (402) never blocks a zero-balance org, serving paid private inference for free. Today nothing in `route.test.ts` mentions credits, so all of this ships green.
- **Root cause**: The refund policy is tested only for the *bulk* path (`src/app/api/org/scan/route.test.ts`), which is a structurally different route. The far higher-traffic `/api/scan` route — where `isMeteredScan` → `checkScanEntitlement` → `consumeScanCredit` → `refundCredit` are wired together with quota refunds, coalescing, and cache — has zero coverage of the money branches.
- **Impact**: Direct revenue leak (paid scans served free) or double-charging (refund regressions) on the product's main entry point; both are silent because the report body still renders 200.
- **Fix sketch**: Mirror the org/scan test harness against `src/app/api/scan/route.ts`. Mock `@/lib/entitlement` + `@/lib/db`. Assert four invariants: (a) `checkScanEntitlement` returns `allowed:false` → response status 402 and `consumeScanCredit` NOT called; (b) a real `gemini` scan that persists a new row → `consumeScanCredit` called once, `grantCredits(...,1,{reason:"refund"})` NOT called, `x-ascent-credits-remaining` header reflects the post-debit balance; (c) `persisted.deduped===true` → exactly one refund grant; (d) `scanRepository` throws → exactly one refund grant (and at most one — `creditReserved` flips false so a later throw can't double-refund).

## 2. Test grantCredits webhook idempotency (the anti-double-grant guarantee)
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/db/credits.ts:79-139 (externalId fast-path + P2002 catch); src/lib/db/credits.test.ts has no idempotency test
- **Scenario**: A Polar top-up webhook redelivers the same `externalId` (GitHub/Polar retries are routine). A regression removes the fast-path `findUnique({where:{externalId}})` short-circuit, or the `isDuplicateExternalId` (P2002) catch stops recognizing the unique-constraint rollback, or `externalId` stops being written to the ledger row — and the same order grants credits twice. The existing tests use `fakePrismaForGrant`, which models *no* `externalId`, *no* `creditLedger.findUnique`, and *no* unique-constraint enforcement, so the entire idempotency mechanism is invisible to the suite.
- **Root cause**: The grant tests only cover the clamp/ledger arithmetic. The most business-critical property of `grantCredits` — "a webhook can safely retry without ever double-granting" (its own docstring, lines 76-77) — is asserted nowhere.
- **Impact**: Free credits minted on every webhook retry = direct give-away of the metered product, and a corrupted append-only ledger that no longer reconciles against Polar.
- **Fix sketch**: Extend the grant fake with a `creditLedger.findUnique({where:{externalId}})` and a unique-index simulation (second `create` with a seen `externalId` throws `{code:"P2002"}`). Assert: (a) calling `grantCredits("acme",100,{externalId:"ord_1"})` twice yields ONE ledger row and the balance increments only once (fast-path hit on the 2nd call); (b) when the fast-path is bypassed (two concurrent calls both miss the pre-check), the duplicate `create` throws P2002, the whole tx rolls back (balance NOT double-incremented), and the function returns the current balance rather than throwing. Invariant: `count(ledger rows with externalId=X) <= 1` and `balanceAfter` never reflects a double-apply.

## 3. Cover getCreditReconciliation's refund-vs-grant classification
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/db/credits.ts:227-241 (no test anywhere)
- **Scenario**: `getCreditReconciliation` powers the /usage money report (debited/refunded/granted/net over a window). The classifier splits positive deltas by `/refund/i.test(e.reason)` and windows rows by `createdAt >= now - days*86_400_000`. A regression — e.g. refund rows getting `reason:"adjustment"` instead of `"refund"`, or the window cutoff being off-by-one/half-open at the wrong edge — silently misreports spend. Because the function is untested, `debited`/`refunded`/`net` can drift with zero signal.
- **Root cause**: All accounting verification stops at `grantCredits`/`consumeScanCredit`; the read-side aggregation that customers and finance actually look at is unguarded. The refund classification is a fragile regex over a free-text `reason` field.
- **Impact**: Customers see a wrong credit-burn report; internal reconciliation against Polar top-ups is computed from an unverified function → billing disputes are adjudicated on bad numbers.
- **Fix sketch**: Mock `getCreditLedger` (or the prisma read) to return a fixed set of entries spanning the window boundary with mixed reasons. Assert: a `delta:-1,reason:"scan"` counts toward `debited` (abs); a `delta:+1,reason:"refund"` counts as `refunded` not `granted`; a `delta:+50,reason:"grant"` counts as `granted` not `refunded`; `net === sum(all deltas)`; and a row with `createdAt` just BEFORE the `days` cutoff is excluded while one just after is included. Invariant: `debited - refunded` reconciles to net credit consumption, and refund rows never inflate `granted`.

## 4. Add a route test for the grant endpoint's authorization + mint guards
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/app/api/org/credits/grant/route.ts:21-49 (no test file exists)
- **Scenario**: This endpoint is the only self-serve path that can add credits, and its comment explicitly warns that exposing it would "let an owner mint free scans." A regression that drops the `grantsEnabled()` check (production guard), the `isSameOrigin` CSRF check, the `requireOrgRole(org,"owner")` gate, or the `Math.abs(amount) > 100_000` clamp opens free-credit minting or a CSRF-driven balance change. None of these four guards is tested.
- **Root cause**: The route composes four independent guards plus `grantCredits`; the underlying `grantCredits` is unit-tested but the gating that decides *whether it's even allowed to run* is not.
- **Impact**: A privilege-escalation / CSRF / production-misconfig regression mints unlimited free private scans — a direct monetization bypass — with no test to catch it.
- **Fix sketch**: Mock `@/lib/db`, `@/lib/authz`, `@/lib/auth`. Assert, each independently: (a) `ASCENT_ALLOW_CREDIT_GRANTS` unset → 403 and `grantCredits` NOT called; (b) `isSameOrigin` false → 403, no grant; (c) `requireOrgRole` returns a denial Response → that Response is returned, no grant; (d) `amount:0` and `amount:100001` → 400, no grant; (e) the happy path (all guards pass) → `grantCredits` called once with `actor` = the session login. Invariant: `grantCredits` is invoked iff all four guards pass.

## 5. Assert consumeScanCredit's plan-resolution and casing contract for non-enterprise unlimited tiers
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/db/credits.ts:147-189; src/lib/db/credits.test.ts:84-93 (only "enterprise" tested)
- **Scenario**: `consumeScanCredit` no-ops on `isUnlimitedPlan(org.plan)`, but the test only proves this for the literal `"enterprise"` string. `isUnlimitedPlan` is data-driven from `PLAN_FEATURES` (src/lib/plans.ts), so if a future plan gains `unlimited:true`, or `enterprise` is later renamed, the test gives false confidence that "unlimited plans don't debit" while actually only pinning one hardcoded value. Separately, the lowercase-slug contract (`slug = orgSlug.toLowerCase()`) — the documented fix for mixed-case orgs reading $0/free and being wrongly paywalled (credits.ts:52-54) — is not asserted in the debit path.
- **Root cause**: The unlimited test couples to a magic string instead of to the `isUnlimitedPlan` contract; the casing-normalization invariant is documented but unexercised in `consumeScanCredit`/`grantCredits`.
- **Impact**: A plan-config change silently starts debiting an "unlimited" org (or stops debiting a metered one); a mixed-case org slug paywalls a paid customer. Both are billing-correctness bugs.
- **Fix sketch**: (a) Drive the unlimited no-op test from `isUnlimitedPlan` rather than the literal — assert that for *every* plan where `isUnlimitedPlan(plan)` is true, `consumeScanCredit` returns `{ok:true,unlimited:true}` and writes no ledger row; and for a non-unlimited plan it debits. (b) Add a casing test: call `consumeScanCredit("ACME")` and assert the `findUnique`/`updateMany` `where.slug` is `"acme"`. Invariant: debit behavior is keyed on the plan's `unlimited` flag and the canonical lowercase slug, never on a raw string.
