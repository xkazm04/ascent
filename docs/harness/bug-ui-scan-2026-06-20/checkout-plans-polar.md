> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

# Checkout & Plans (Polar) — combined bug+ui scan

## 1. Org-not-found webhook grant is swallowed → Polar gets 200 → paid credits permanently lost
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / revenue-loss
- **File**: src/app/api/billing/webhook/route.ts:49
- **Scenario**: A buyer completes a Polar checkout for a real credit pack, but the bound org slug does not resolve at fulfilment time — e.g. the `order.paid` webhook arrives before the org row is created, the org was renamed/deleted after checkout, or `externalCustomerId`/metadata carries a slug that no longer matches a row. `grantCredits()` returns `null`; the handler logs `"... credits unfulfilled"` and `return`s normally.
- **Root cause**: The `@polar-sh/nextjs` `Webhooks()` adapter only retries when the handler THROWS — on a normal return it responds `200 {received:true}` (verified in `node_modules/@polar-sh/nextjs/dist/index.js`: it `await handleWebhookPayload(...)` then returns 200; only an exception propagates a 500). Returning after `grantCredits()===null` tells Polar the event was delivered, so the at-least-once delivery guarantee the idempotency design relies on never fires for this case. The paid order is never re-attempted.
- **Impact**: A customer pays real money and receives no credits; the event is gone with no automatic recovery. Pure revenue-loss on the money path, exactly the class of "drop a paid event" this context warns about. (`grantCredits` writes NO ledger row carrying the order's `externalId` in this branch, so a retry WOULD have correctly granted — the only thing blocking recovery is the 200.)
- **Fix sketch**: Make unfulfilled-but-real grants retryable: when `creditsForProduct(productId) > 0` but `grantCredits` returns `null` (org missing) or no org is bound, `throw` so the adapter returns non-2xx and Polar redelivers. Keep the genuine no-op (`credits <= 0`) as a normal 200. Optionally add a dead-letter/alert after Polar's retry budget is exhausted.

## 2. Buying a credit pack never upgrades the plan tier — paid Pro/Team features stay locked
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: entitlement / billing-correctness
- **File**: src/app/api/billing/webhook/route.ts:24
- **Scenario**: `/pricing` sells Pro and Team as feature tiers ("Org fleet dashboard", "Scheduled autoscans + alerts", "White-label briefings", larger seat counts), and entitlement gates those features on `org.plan` (`isUnlimitedPlan`/`planAllowsWhiteLabel`/`scanAllowance` all key off the stored plan). But the ONLY purchase mechanism — the Polar webhook — calls `grantCredits()` exclusively and never `setOrgPlan()`. There is no `onSubscription*` handler and no plan↔product map. The only way to reach a paid plan is the owner-gated manual override (`/api/org/plan`, behind `ASCENT_ALLOW_PLAN_CHANGES`).
- **Root cause**: The webhook treats every `order.paid` as a credit top-up regardless of `order.billingReason` (`purchase` vs `subscription_create`/`subscription_cycle`) and ignores any tier the product represents. Credits and plan are orthogonal in the code, but the pricing page implies a Pro/Team purchase confers tier features.
- **Impact**: A customer who pays for "Pro"/"Team" gets credits but remains on `free` (10/mo allowance, no fleet dashboard / white-label / extra seats / extended retention). Either over-charged-for-nothing or features silently withheld — a revenue/trust mismatch with the public pricing claims.
- **Fix sketch**: Add a product→plan map (e.g. `POLAR_PLAN_PRODUCTS`) and, in the webhook, when `order.productId` maps to a tier call `setOrgPlan(org, tier)` (and on subscription-cancel/refund events downgrade). Until subscriptions exist, make `/pricing` honest that Pro/Team are credit-volume tiers, not feature unlocks.

## 3. Checkout binds payment to an unvalidated, unauthenticated org slug
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation / authz
- **File**: src/app/api/billing/checkout/route.ts:21
- **Scenario**: `GET /api/billing/checkout?org=<slug>&pack=<id>` accepts ANY `org` string from the query with no check that the org exists or that the requester is a member/owner. It is set as `externalCustomerId` + `metadata.org` and drives the eventual credit grant. A typo (`org=acme-ic` vs `acme-inc`) creates a paid checkout that fulfils to a non-existent org → combined with finding #1, the payment is lost.
- **Root cause**: The route's documented stance ("no CSRF/owner gate — the trust boundary is the webhook signature") justifies skipping the auth gate for state changes, but it also skips basic *existence* validation, so a checkout can be created for a target that can never receive the credits. The "gift credits to any org" affordance is benign, but "pay into a void" is not.
- **Impact**: Lost payments on malformed/nonexistent slugs (no fail-fast); no audit of who initiated a checkout for which org. Lower severity than #1 because the slug is payer-controlled and verified at webhook time, but it removes the only cheap guard against an unrecoverable mis-bind.
- **Fix sketch**: Look up the org before creating the Polar checkout and 404 on a missing org (DB read only, no auth needed). Optionally require a viewer/membership when a session exists, while still allowing the documented anonymous gift path for known orgs.

## 4. `creditPacks()` silently accepts duplicate product ids; first-listed wins, UI shows both
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: config-robustness
- **File**: src/lib/polar.ts:38
- **Scenario**: `POLAR_CREDIT_PACKS="prod_a=100,prod_a=500"` (an ops typo) is parsed into two packs with the same `productId`. The "Buy credits" UI lists both, but `creditsForProduct("prod_a")` returns the FIRST match (100) via `.find`, so a buyer who picks the 500-shown card is granted 100.
- **Root cause**: Parsing preserves every well-formed entry without de-duplicating on `productId`, and the webhook grant resolves by first match — so the displayed amount and the granted amount can diverge for a duplicated id.
- **Impact**: Under-granting relative to what the UI advertised, only under a misconfigured env. No security impact; bounded blast radius.
- **Fix sketch**: De-dup by `productId` in `creditPacks()` (keep first or last consistently) and warn on a collision, so the catalog the UI shows and the catalog the webhook grants from are guaranteed identical.

## 5. Clearing the Repositories field puts NaN into the controlled input
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: form-state / polish
- **File**: src/app/pricing/CreditEstimator.tsx:61
- **Scenario**: The user clears the "Repositories" number input. `e.target.valueAsNumber` is `NaN`, so `setRepos(NaN)` runs and the controlled `value={repos}` becomes `value={NaN}`, producing a React "received NaN for the `value` attribute" warning and a sticky/odd field state until a digit is re-typed.
- **Root cause**: The estimate math is guarded (`safeRepos` via `Number.isFinite`), but the raw NaN is still written back into component state and fed to the controlled `<input value>`.
- **Impact**: Console warning + a momentarily broken-feeling input on the public pricing page; no data or money effect.
- **Fix sketch**: Normalize on change — `setRepos(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)` (or store `""` and coerce in the math) so the controlled value is always a finite number.
