# Billing — plans, monthly allowance & prepaid credits

_Status: **implemented end-to-end** — four plan tiers (`src/lib/plans.ts`), a monthly-allowance-then-credit
hybrid charge model, a Polar purchase flow for both credit packs and plan-tier upgrades (checkout route +
a signature-verified, idempotent fulfilment webhook), and a refund/clawback flow that reverses credits and
downgrades a plan on a full refund. The accounting layer stays provider-agnostic: anything that calls
`grantCredits`/`setOrgPlan` moves the org's entitlement, and the scan code never imports the billing SDK._

## Plan tiers (`PLAN_FEATURES` in `src/lib/plans.ts`)

| Plan | Monthly price | Included scans/mo | Seats | Retention | Extra gates |
| --- | --- | --- | --- | --- | --- |
| `free` | $0 | 5 | 1 | 30 days | — |
| `pro` | $10 | 100 | 3 | 180 days | — |
| `team` | $20 | 500 | 10 | 365 days | White-label briefings, Org Skills Library authoring, Shared Org Memory writes |
| `enterprise` | Custom | Unlimited (`unlimited: true`) | Unlimited | Unlimited | Everything in Team, plus BYOM (bring-your-own-model) |

Notes, all read directly from the model:

- `monthlyPrice` on each tier is **display-only** — a duplicate of the Polar product's price for the
  `/pricing` page. There is no automated reconciliation between the two, so a price change in the Polar
  dashboard must be mirrored in `PLAN_FEATURES` or `/pricing` advertises a stale number.
- `includedCredits` is the monthly **metered-scan allowance** (private/org scans only — anonymous public
  scans are never metered and don't touch this). `null` means unlimited (Enterprise).
- Feature gates are individual predicates, each defaulting unknown/blank plans to `free`:
  - `planAllowsWhiteLabel(plan)` — Team and Enterprise.
  - `planAllowsSkillsLibrary(plan)` — Team and Enterprise (authoring the Org Skills Library; reads stay
    open to all members).
  - `planAllowsMemory(plan)` — Team and Enterprise (writing to Shared Org Memory; reads stay open).
  - `planAllowsByom(plan)` — Enterprise only (connect the org's own LLM/Bedrock).
- `retentionCutoff(plan, nowMs)` gives the earliest scan date a plan's retention window includes (`null`
  for Enterprise/custom). It's a **non-destructive read floor** — history/trend/trajectory reads are
  clamped to it; nothing is ever deleted.
- `PLAN_ORDER = ["free", "pro", "team", "enterprise"]` is the cheapest→richest display/upgrade order, also
  used by the webhook's downgrade-guard rank comparison (see Refunds below).

## The hybrid charge model

Each **metered** scan (a real-inference scan against a private/org repo, gated by `isMeteredScan` in
`src/lib/entitlement.ts`) is billed by `resolveScanCharge` / the pure `decideScanCharge` in
`src/lib/plans.ts`:

```ts
export type ScanCharge = "unlimited" | "allowance" | "credit" | "denied";
```

1. **`unlimited`** — the org is on the Enterprise plan (`isUnlimitedPlan`); never charged.
2. **`allowance`** — the org's month-to-date metered scan count (`countMeteredScansThisMonth`, a UTC
   calendar-month window reset at 00:00 UTC on the 1st) is still under the plan's `includedCredits`; free,
   no credit debit.
3. **`credit`** — the allowance is used up but the org has a positive prepaid credit balance
   (`Organization.scanCredits`); one credit is debited.
4. **`denied`** — allowance spent and no credits left → the 402 / upgrade moment.

`resolveScanCharge` is the single wiring point read by **both** the read gate (`checkScanEntitlement`,
which reports `allowed`/`withinAllowance`/`allowanceRemaining` for UI and bulk-batch sizing) and the write
gate (`consumeScanCredit` in `src/lib/db/credits.ts`), so the two paths can't drift. `consumeScanCredit`'s
allowance check is a soft, non-atomic read (concurrent lanes near the boundary can all see the same stale
usage count and all classify "allowance"); the credit **debit** itself is the hard, concurrency-safe gate
(`UPDATE … WHERE scanCredits > 0`, so it can never drive the balance negative). The route checks
entitlement **before** paid inference and debits/records **after**, so a cache/dedup hit or a
degrade-to-mock run is never charged.

- **Public scans** — always free and unmetered, forever; never touch allowance or credits.
- **Enterprise** — `unlimited: true`; never debited regardless of usage.

## Credit packs vs. plan products (Polar catalogs)

Both catalogs live in `src/lib/polar.ts` and are parsed from env, comma-separated `key=value` pairs. A
single Polar product id **can appear in both** (an upgrade that also seeds credits) — the webhook applies
whichever mapping matches.

- **`POLAR_CREDIT_PACKS`** — `<productId>=<credits>` pairs (e.g. `prod_abc=100,prod_def=500`). Read by
  `creditPacks()` / `creditsForProduct()`. This is the source of truth for both the "Buy credits" UI and
  how many credits a paid order grants — the amount is decided by the **product purchased**, never by
  anything the client sends.
- **`POLAR_PLAN_PRODUCTS`** — `<productId>=<planId>` pairs (e.g. `prod_pro=pro,prod_team=team,prod_ent=enterprise`).
  Read by `planProducts()` / `planForProduct()`. Entries whose plan isn't a known `PlanId` are skipped.
  Unset → no product upgrades a tier (billing stays credit-only).
- `polarEnabled()` is true when a Polar access token is set **and** at least one of the two catalogs is
  non-empty — a subscription-only deployment (plan products but no à-la-carte packs) is a valid, supported
  config and still enables checkout.

## Checkout flow (`GET /api/billing/checkout?org=<slug>&pack=<productId>`)

1. Rejects if billing isn't configured (`polarEnabled()` false → 503), if the request looks like a
   speculative prefetch/prerender (`isPrefetch` checks `Sec-Purpose`/`Purpose`/`X-Moz`/`X-Purpose` headers
   → 204 no-op), or if it isn't same-origin (`isSameOrigin` → 403) — a GET that mints a real, billable Polar
   session must never fire from a link prefetcher, crawler, or cross-origin probe.
2. Validates `pack` against **both** catalogs (`creditsForProduct(pack) > 0` or `planForProduct(pack)`); an
   unknown/forged product id → 400.
3. If a DB is configured, resolves the org and 404s an unknown slug with a uniform message (doesn't echo
   the slug back, so the response can't be used as an org-existence oracle); a DB-unavailable read is a
   retryable 503, not a misleading 404.
4. Creates a hosted Polar checkout (`polar.checkouts.create`) carrying the org in **both**
   `externalCustomerId` and `metadata.org`, and 303-redirects the browser to it. No credits or plan change
   happen here — the trust boundary for the actual grant is the webhook signature.

## Webhook (`POST /api/billing/webhook`)

Built on the `@polar-sh/nextjs` `Webhooks()` adapter, signature-verified against `POLAR_WEBHOOK_SECRET`.
Fails **closed**: if the secret is unset, the route responds 503 instead of trusting an unverified body.
Handled events:

- **`order.paid`** — resolves the org (`customer.externalId`, falling back to `metadata.org`) and, from
  the purchased product:
  - if it maps to a **plan product**, calls `setOrgPlan(org, plan)` — but only when the order's embedded
    subscription is still entitling (`subscriptionEntitlesTier`: active/trialing/past_due and not ended),
    guarding against an out-of-order stale renewal event re-applying a tier the customer no longer holds.
  - if it maps to a **credit pack**, calls `grantCredits(org, credits, { reason: "polar", externalId:
    "polar:<orderId>" })`.
  - A product that's neither is logged and skipped (visible config error, not a silent purchase drop). A
    paid order that can't resolve an org **throws** (rather than returning), so the adapter surfaces a
    non-2xx and Polar redelivers under its at-least-once guarantee — the idempotency keys below make a
    retry safe.
  - A recurring (subscription) plan/pack product re-fires `order.paid` every billing cycle, so it
    auto-recharges credits / re-asserts the tier with no extra code.
- **`order.refunded`** — reverses what the order granted, proportionally:
  - Credits: claws back via `clawbackOrderRefund(org, orderId, targetClawback, { eventKey })`, where
    `targetClawback = round(packCredits × fraction)` and `fraction = refundedAmount / netAmount` (both
    cumulative Polar fields). Because `refundedAmount` is cumulative and can arrive across several refund
    events (partial-then-partial, partial-then-full), `clawbackOrderRefund` computes and applies only the
    **marginal** share not yet reversed (tracked via a `polar-refund:<orderId>:<eventKey>` external id), so
    any sequence of refund events reconciles to the true refunded fraction without double-clawing. The
    stored balance clamps at zero (an already-spent balance absorbs what remains). A `netAmount <= 0`
    order ($0/comp) is skipped — there's nothing to claw back.
  - Plan: a **full** refund/chargeback (`refundedAmount >= netAmount`, tested on the raw cumulative
    amounts so rounding can't smuggle a partial past this) additionally calls `setOrgPlan(org, "free")`. A
    partial refund of a subscription invoice does **not** revoke the tier.
  - Both paths first check `retainedHigherPlan`: if the org's *current* plan outranks (via `PLAN_ORDER`)
    the tier this specific order/subscription conferred, the downgrade is skipped — protects a manually
    hand-set higher tier (via `/api/org/plan`, see below) from being stripped by an unrelated lapsing
    subscription.
- **`subscription.revoked`** — the authoritative "access is definitively gone" signal (immediate
  cancellation, an elapsed cancel-at-period-end window, or exhausted payment retries) → downgrades to
  `free` via the shared `downgradeSubscription` helper (same retained-higher-plan guard).
- **`subscription.canceled`** — if `cancelAtPeriodEnd` is true, access is retained until
  `currentPeriodEnd` and **no** downgrade happens yet (the matching `subscription.revoked` will fire when
  the period ends); if false (an immediate cancellation), downgrades now.

All of the downgrade/grant/clawback operations are idempotent (`setOrgPlan` is an idempotent `updateMany`
to a fixed value; `grantCredits`/`clawbackOrderRefund` key on a unique `externalId`), so webhook
redelivery, or both `revoked` and `canceled` firing for one cancellation, converge safely on the same
state.

## Manual overrides (outside Polar)

- **`POST /api/org/plan`** (`src/app/api/org/plan/route.ts`) — owner-gated. Downgrading to `free` is
  always allowed. Setting any paid/unlimited tier requires `ASCENT_ALLOW_PLAN_CHANGES=true` (the manual
  override path — normal paid upgrades go through Polar checkout); without it the route returns 403
  `USE_CHECKOUT`. Every change is recorded via `recordOrgAudit("org.plan", ...)`.
- **`POST /api/org/credits/grant`** — owner-only, gated behind `ASCENT_ALLOW_CREDIT_GRANTS`. Calls
  `grantCredits` directly (dev/manual top-up path, same accounting as the webhook).

## Ledger & consumption safety (`src/lib/db/credits.ts`)

- `Organization.scanCredits` is the balance; `CreditLedger` is the append-only audit trail (`delta`,
  `balanceAfter`, `reason`, `repoFullName`, `scanId`, `actor`, `externalId`). Canonical `reason` values:
  `CREDIT_REASON.{SCAN, GRANT, ADJUSTMENT, REFUND, POLAR_REFUND}`.
- `grantCredits` / `consumeScanCredit` / `clawbackOrderRefund` all run inside a transaction with
  `withRetry` and a stable `externalId` (caller-supplied for webhook events, else synthesized
  per-invocation), so a commit-ambiguity retry or an at-least-once webhook redelivery can never
  double-grant, double-debit, or double-claw.
- `consumeScanCredit`'s debit is a conditional decrement (`scanCredits > 0`), so two concurrent scans can
  never drive the balance negative; the loser retries under Aurora DSQL serialization.
- `getCreditReconciliation(org, days)` buckets ledger rows into `debited` / `refunded` / `granted` / `net`
  over a window, used by the `/usage` reconciliation panel — refund-reason rows are excluded from
  `debited` so a Polar clawback isn't double-counted as scan spend.

## Env vars

```
POLAR_ACCESS_TOKEN=          # server-side Polar Organization Access Token
POLAR_WEBHOOK_SECRET=        # verifies POST /api/billing/webhook signatures; unset → webhook fails closed (503)
POLAR_SERVER=sandbox         # sandbox (default) | production
POLAR_CREDIT_PACKS=prod_abc=100,prod_def=500,prod_ghi=2000
POLAR_PLAN_PRODUCTS=prod_pro=pro,prod_team=team,prod_ent=enterprise
ASCENT_ALLOW_CREDIT_GRANTS=  # enables POST /api/org/credits/grant (owner-gated manual top-up)
ASCENT_ALLOW_PLAN_CHANGES=   # enables POST /api/org/plan to set a paid/unlimited tier directly (bypassing checkout)
```

`LLM_INPUT_COST_PER_MTOK` / `LLM_OUTPUT_COST_PER_MTOK` (see [usage.md](usage.md)) turn recorded token usage
into a $ estimate on `/usage` — useful for calibrating pack/plan prices against real inference cost.

## Known gaps

- **Price drift risk** — `PLAN_FEATURES[..].monthlyPrice` (display) and the actual Polar product price
  have no automated reconciliation; a Polar dashboard price change must be mirrored by hand.
- **Allowance boundary is a soft gate** — `countMeteredScansThisMonth` is a non-atomic read, so concurrent
  scans crossing the monthly-allowance boundary can overshoot the free allowance by a small, bounded
  amount (never paid credits, which are hard-gated). A fully atomic bound would need a monthly-usage
  counter (schema change).
- **Stale out-of-order tier resurrection** — the `order.paid` stale-paid fence only catches an event whose
  *own* payload shows the subscription already lapsed; a redelivery carrying a stale but still-"active"
  snapshot would still apply. The revoke/refund handlers are the authoritative correction for this case.
- **Seat enforcement** — `seats` is defined per plan but this doc did not verify seat-limit enforcement at
  the membership-write path; treat as unconfirmed.
- **Email receipts** — Polar sends its own; Ascent doesn't send a separate one.
