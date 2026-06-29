# Biz+Bug Scan — Billing, Credits & Metering — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 4 contexts.
> Total: 20 findings — Critical: 0, High: 5, Medium: 11, Low: 4  (bug: 12, business: 8)

---

## Checkout & Plans (Polar)

### 1. Split / partial refunds let a buyer keep credits after a refund
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/billing/webhook/route.ts:74-99
- **Scenario**: A buyer purchases a credit pack, spends nothing or part of it, then asks Polar for the refund in **two or more separate partial refunds** on the same order. The clawback is idempotent on `polar-refund:${order.id}`, so only the FIRST `order.refunded` event ever lands; every later partial-refund delivery short-circuits on the existing externalId. The buyer is refunded in full but keeps most of the granted credits (and the scans they buy).
- **Root cause / Rationale**: Idempotency is keyed on the order id, not on a per-refund id, so the second+ refund increments are dropped. The code comment already acknowledges this gap but ships it unmitigated.
- **Impact**: Direct revenue loss / theft of paid scans; trivially repeatable once discovered.
- **Fix sketch**: Key clawback idempotency on the refund/transaction id (or accumulate `refundedAmount` and reverse to the new cumulative target), so each partial refund reverses its own share.

### 2. Refund clawback fraction uses `netAmount` as the denominator against a gross-based `refundedAmount`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/app/api/billing/webhook/route.ts:85-87
- **Scenario**: An order with tax/fees has `totalAmount` > `netAmount`. `gross = netAmount` (preferred when > 0), but `refundedAmount` is typically measured against the amount charged (total). A 50%-of-charge partial refund then computes `fraction = refundedAmount/netAmount > 0.5`, clawing back more credits than the customer actually got refunded (and the inverse when the basis flips).
- **Root cause / Rationale**: The numerator and denominator are drawn from two different money bases (refunded-of-total vs net-of-fees) without normalization.
- **Impact**: Over- or under-clawback on every taxed partial refund; ledger drifts from reality.
- **Fix sketch**: Use the SAME basis for both — divide `refundedAmount` by `totalAmount` (or compare both in Polar's documented refund semantics), not `netAmount`.

### 3. Fulfilment webhook throws forever when the bound org no longer exists
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/app/api/billing/webhook/route.ts:53-63
- **Scenario**: Checkout validates the org exists, but if the org is deleted/renamed between checkout and `order.paid` (or the slug never resolves), `grantCredits` returns null and the handler `throw`s to force a Polar retry. Polar redelivers under at-least-once until it gives up — then the paid credits are permanently lost with money already taken.
- **Root cause / Rationale**: A permanent "org missing" is treated identically to a transient DB blip (both throw-to-retry); there's no dead-letter / alert for an unfulfillable-but-paid order.
- **Impact**: Silent paid-but-unfulfilled orders; support burden, chargebacks.
- **Fix sketch**: Distinguish permanent (org gone) from transient: on permanent, log+alert (or park the grant against the externalId for later manual binding) instead of throwing into an infinite retry.

### 4. Pricing page shows no actual price for Pro/Team ("Prepaid") — a conversion dead-end
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/app/pricing/page.tsx:16-21
- **Scenario**: A prospect comparing Ascent to Snyk/SonarCloud/CodeClimate lands on `/pricing` and sees Pro/Team as "Prepaid · credits — 1 per scan over your allowance" with no dollar figure. They can't estimate cost, so they bounce. The code deliberately avoids "inventing" prices, but the result is a price page with no prices.
- **Root cause / Rationale**: Prices live only in Polar and aren't surfaced; the page asserts a model but not a number.
- **Impact**: Lost activation at the highest-intent page; competitors all show concrete pricing.
- **Fix sketch**: Pull the credit-pack prices from Polar (or a small `PRICE` env/config) and render a real "$X for N scans" anchor + a worked example tied to the CreditEstimator already on the page.

### 5. No self-serve subscription/upgrade path — recurring revenue left on the table
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/app/pricing/page.tsx:75-80, src/app/api/org/plan/route.ts:34-39
- **Scenario**: The only purchasable thing is a one-off credit pack (`/api/billing/checkout?pack=`). Becoming a Pro/Team subscriber has no checkout — `setOrgPlan` to a paid tier is gated behind the `ASCENT_ALLOW_PLAN_CHANGES` manual-override env, and the pricing CTAs just link to `/connect`. Tiers are effectively marketing with no buy button.
- **Root cause / Rationale**: Plan tiers were wired for display/entitlement but never connected to a Polar subscription product.
- **Impact**: No predictable MRR; every customer is a manual, one-off credit transaction. Worst monetization gap in the group.
- **Fix sketch**: Add a Polar subscription product per paid tier; on `order.paid`/subscription webhooks call `setOrgPlan` server-authoritatively (same pattern as credit grants), and make the pricing CTAs start that checkout.

---

## Quotas & Rate Limiting

### 1. `clientIp` "unknown" fallback collapses the entire anonymous weekly quota into one bucket
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/lib/rate-limit.ts:17-26, src/lib/public-scan-quota.ts:94
- **Scenario**: On any deployment where neither `x-real-ip` nor `x-forwarded-for` is set (mis-set reverse proxy, direct origin, header rename), `clientIp` returns the literal `"unknown"` for everyone. The weekly public-scan quota then hashes ALL anonymous visitors into ONE shared 7-day bucket — after 3 scans total, the entire public funnel is locked for a week globally.
- **Root cause / Rationale**: The collective fail-closed fallback is correct for a per-minute burst limiter but catastrophic when reused as the key for a 7-day, low-N persistent quota.
- **Impact**: Site-wide free-funnel lockout from a benign proxy misconfig; no telemetry distinguishes "one shared bucket saturated" from real demand.
- **Fix sketch**: When the IP is `"unknown"`, treat the weekly quota as un-enforceable (fail OPEN) rather than charging a shared bucket; add a startup/observability warning when a high share of requests resolve to `"unknown"`.

### 2. Per-instance global rate-limit ceiling is illusory on the production (DSQL/serverless) topology
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/lib/rate-limit.ts:1-9, 28
- **Scenario**: The `windows` Map is module-global, so the "global spend ceiling" (`RATE_LIMIT_SCAN_GLOBAL`, badge global, etc.) is per-process. The prod stack is Aurora DSQL + horizontally-scaled Next, so the real LLM-spend cap is `instances × global` and rises with autoscale exactly when load (and abuse) is highest.
- **Root cause / Rationale**: An in-memory limiter can't enforce a cross-instance budget; documented as a TODO but the cost backstop it's sold as doesn't hold in prod.
- **Impact**: The intended dollar ceiling on a flood of expensive scans is not actually enforced.
- **Fix sketch**: Back the global window with the shared store already present (Redis/Upstash, or a DB token-bucket) for the global tier; keep per-IP in memory.

### 3. Quota fail-open events are unobservable
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/public-scan-quota.ts:244-248, src/lib/db/quota-events.ts:12-24
- **Scenario**: A DB blip makes `consumePublicScanQuota` fail OPEN (correct), silently disabling the weekly cost gate for the duration. `recordQuotaEvent` counts denials and rate-limit trips but NOT fail-opens, so an operator watching the /usage "Abuse & limits" panel sees quiet numbers while the gate is actually off and LLM spend is uncapped.
- **Root cause / Rationale**: The catch logs to console only; there's no durable counter for "gate bypassed due to store error".
- **Impact**: A cost-control gate can be down indefinitely with no signal.
- **Fix sketch**: Increment a `quota_fail_open` counter (best-effort, same table) in the catch so saturation/outage is visible.

### 4. The blocked-quota moment dead-ends at `/pricing` instead of converting
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: activation
- **File**: src/components/report/QuotaNotice.tsx:38-66
- **Scenario**: When a user hits the weekly cap, `QuotaBlocked` offers "See plans →" → a pricing page with no anonymous purchase path (see Checkout finding 5). This is the single highest-intent conversion point in the funnel (they wanted one more scan right now) and it dead-ends.
- **Root cause / Rationale**: The CTA points at a page that can't transact.
- **Impact**: The best activation moment is wasted.
- **Fix sketch**: Make the blocked state the activation surface — inline "create org + buy a small pack" (or a one-time bonus for connecting GitHub / verifying email), so the user resolves the block without leaving.

### 5. The sign-in quota lever isn't amplified with referral / email capture
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth
- **File**: src/lib/public-scan-quota.ts:55-59, src/components/report/QuotaNotice.tsx:119-158
- **Scenario**: Signing in lifts the weekly limit 3→20 (good), but there's no further loop: no email capture for "+N scans", no "share your report / invite a teammate for more scans" mechanic. The funnel's one growth lever stops at sign-in.
- **Root cause / Rationale**: The elevated bucket is the only incentive; no viral/re-engagement hooks layered on it.
- **Impact**: Misses a cheap acquisition loop on an already-engaged audience.
- **Fix sketch**: Add an env-gated "share-for-credit" / email-verify bonus that bumps the per-user weekly allowance, tracked in the same quota row.

---

## Credits & Entitlements

### 1. Monthly free-allowance overshoot under concurrent scans (real on high-allowance tiers)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/db/credits.ts:166-199
- **Scenario**: The allowance check reads `countMeteredScansThisMonth` (persisted Scan rows) outside the debit transaction. At the allowance boundary, all in-flight lanes read the same stale count and each classify "allowance" (free). The free overshoot is O(in-flight lanes) per boundary crossing — up to `SCAN_CONCURRENCY-1` per batch, more across simultaneous batches — not "one".
- **Root cause / Rationale**: Allowance is a soft, non-atomic read; only the credit decrement is concurrency-safe. Documented, but a real giveaway for Team (allowance 500) running parallel imports.
- **Impact**: Orgs get more free metered scans than their tier allows; under-billing.
- **Fix sketch**: Track month-to-date metered usage in an atomic counter (conditional `updateMany ... usageThisMonth < allowance`) so the free allowance is a hard bound like the credit gate.

### 2. Reconciliation mis-buckets Polar refund-clawbacks as scan debits
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/db/credits.ts:288-294, src/app/api/billing/webhook/route.ts:89-93
- **Scenario**: A Polar refund clawback writes a NEGATIVE delta with reason `polar-refund`. Reconciliation counts `debited = sum(delta<0)` (so the clawback is counted as scan spend) and `refunded = sum(delta>0 && /refund/i)` (so it's NOT counted as a refund). The /usage reconciliation panel therefore reports a billing refund as extra "credits debited".
- **Root cause / Rationale**: The `/refund/i` bucket only matches POSITIVE deltas; the negative clawback slips into the debit bucket.
- **Impact**: Money-facing reconciliation drift; "billable vs debited" mismatch note fires spuriously.
- **Fix sketch**: Bucket by reason first (treat `polar-refund` as a refund/reversal line) before the sign-based debit/credit split.

### 3. A missing/typo'd org is indistinguishable from "out of credits"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/credits.ts:45-55, src/lib/entitlement.ts:39-62
- **Scenario**: `getCreditState` returns `{balance:0, plan:"free"}` for a non-existent org, and `consumeScanCredit` returns the same `{ok:false}` shape for "org missing" as for "paywalled". A scan against a slug that doesn't resolve (deletion, casing, typo) yields a generic 402 "out of private-scan credits" rather than "unknown org".
- **Root cause / Rationale**: Both the read gate and the consume path coalesce "no org" into the free/zero/denied state.
- **Impact**: Confusing paywall for a real configuration error; wastes support cycles and looks like a billing bug.
- **Fix sketch**: Surface a distinct "unknown organization" outcome (404/own code) from both `getCreditState` and `consumeScanCredit` when the org row is absent.

### 4. No auto-recharge / low-balance top-up — paying orgs' scans silently hard-stop
- **Severity**: High
- **Lens**: business-visionary
- **Category**: retention
- **File**: src/lib/entitlement.ts:53-63, src/lib/db/credits.ts:180-235
- **Scenario**: When a paying org's balance hits 0, the next private scan gets a hard 402 and scheduled autoscans just stop. The customer's fleet dashboard quietly goes stale until someone notices and manually tops up — a churn and "is this product reliable?" moment, and an interruption of your own revenue.
- **Root cause / Rationale**: Credits are purely prepaid one-offs with no replenishment automation.
- **Impact**: Service disruption + lost recurring spend exactly when the customer is most active.
- **Fix sketch**: Offer opt-in auto-recharge (Polar subscription / "buy N credits when balance < threshold") plus a pre-emptive low-balance email (SES is already wired) before the 402.

### 5. Surface runway/burn at the point of top-up (CreditsControl popover)
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/components/org/CreditsControl.tsx:127-160
- **Scenario**: The runway figure ("≈ Xd at current burn") exists only on `/usage`, not in the credits chip/popover where the buy buttons live. At the decision point the owner sees a bare number and no urgency, so top-ups are reactive (after the 402) instead of proactive.
- **Root cause / Rationale**: Burn/runway is computed on the metering page, not passed into the purchase surface.
- **Impact**: Lower top-up conversion; more orgs hit the hard paywall.
- **Fix sketch**: Pass period burn/runway into `CreditsControl` and render "~Xd left at current pace — top up" next to the pack buttons.

---

## Usage Metering & Public Badge

### 1. Badge-impression write is unbounded on attacker-controlled `Referer`, and bypasses the rate limiter on cache hits
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:312-316, src/lib/db/badge-analytics.ts:15-29
- **Scenario**: `recordBadgeImpression(repo, refererHost)` fires on EVERY successful badge serve, including cache hits — and the rate limiter only runs on a report cache MISS. An attacker hits `/api/badge/facebook/react?x=<rand>` (a query param forces `CACHE_CUSTOM` = private, so the CDN never absorbs it and every request reaches the origin) with a unique forged `Referer` each time. Each request upserts a new `(repoFullName, refererHost)` row with no rate limit.
- **Root cause / Rationale**: `refererHost` is unbounded, attacker-supplied, and the dedup upsert creates a fresh row per distinct host; the only rate gate sits on the scan path, not the tally.
- **Impact**: Unbounded row growth (DB storage/cost) and full poisoning of the /usage "Badge reach — top embedding hosts" analytics on an unauthenticated endpoint.
- **Fix sketch**: Only record impressions on the canonical (un-customized, cacheable) badge path, drop/normalize unknown referer hosts, and/or cap distinct hosts per repo; treat the panel as a lower-bound estimate from trusted hosts only.

### 2. `getUsageSummary` doesn't normalize the org slug — mixed-case queries under-report as empty
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/db/usage.ts:92
- **Scenario**: `findUnique({ where: { slug: orgSlug } })` uses the raw slug. Org slugs are canonically lowercase (credits.ts:50 fixed exactly this, with a comment), but `/api/usage` and `/usage` pass the raw `?org=` through. A query for `?org=Facebook` (or any non-canonical casing) finds no org and returns the all-zero `empty` summary — even when the org exists and has scans. Note `getCreditState` in the same render DOES lowercase, so the page shows a real balance beside zeroed usage.
- **Root cause / Rationale**: The casing canonicalization applied across credits/badge-analytics was never applied in usage.ts.
- **Impact**: Silent under-reporting of metered/billable volume and cost for any non-canonical slug; inconsistent with the credits panel on the same page.
- **Fix sketch**: `where: { slug: orgSlug.toLowerCase() }` (and return the canonical slug), matching credits.ts.

### 3. Daily-series SQL fallback silently degrades to a full row stream
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/lib/db/usage.ts:266-305
- **Scenario**: `fetchDailySeries` uses raw `date_trunc`/`to_char` and falls back to `prisma.scan.findMany` (every row in the window) on any query error. If DSQL ever rejects the raw query persistently, every /usage load for a busy org streams thousands of rows back to bucket in JS — the exact cost the SQL aggregate avoids — logged once but never surfaced.
- **Root cause / Rationale**: The fallback is a correctness net with no rate/visibility guard against becoming the steady state.
- **Impact**: Latent perf cliff on the metering page under a DB-dialect regression.
- **Fix sketch**: Count/alert on fallback usage; consider a Prisma `groupBy` on a stored UTC-date column instead of raw SQL.

### 4. Badge analytics aren't turned into the growth loop they enable (trend badge + leaderboard)
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/lib/db/badge-analytics.ts:48-85, src/app/api/badge/[owner]/[repo]/route.ts:343-363
- **Scenario**: The badge is the core acquisition loop (README → `?ref=badge` → report → scan-your-own), and you already track reach per repo/host. But there's no public "trending / most-scanned repos" leaderboard and no "score improving ↑" trend badge — the two highest-virality artifacts competitors (OpenSSF Scorecard, Codecov) lean on.
- **Root cause / Rationale**: Reach data is shown only as an internal /usage panel; the differentiating public surfaces aren't built.
- **Impact**: Under-uses an owned data asset for top-of-funnel growth and differentiation.
- **Fix sketch**: Add a `?metric=trend` badge (delta arrow vs last scan) and a public leaderboard powered by badge-analytics + scan history (the WIP leaderboard work can consume `getBadgeReach`).

### 5. Detected badge embeds don't trigger an activation nudge to run a real scan
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: activation
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:316,323-324, src/components/badge/BadgeGenerator.tsx:166-169
- **Scenario**: An un-scanned repo's badge renders a deterministic mock labelled "· demo". You record the first impression (host + repo), so you know someone embedded it — but nothing prompts that owner to run a real AI scan to "upgrade" their badge from demo to a credible verdict.
- **Root cause / Rationale**: The impression tally is read-only analytics; it isn't an activation trigger.
- **Impact**: Passive embeds stay stuck at the demo floor instead of converting to real scans (and accounts).
- **Fix sketch**: On a first-seen impression for a repo with only a mock report, surface (or email via SES, if the owner is known) a "your badge is in demo mode — run a real scan to upgrade it" nudge.
