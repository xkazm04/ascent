# Billing — plans, monthly allowance & prepaid credits

_Status: **implemented end-to-end** — four plan tiers (`src/lib/plans.ts`), a monthly-allowance-then-credit
hybrid charge model, a Polar purchase flow for both credit packs and plan-tier upgrades (checkout route +
a signature-verified, idempotent fulfilment webhook), and a refund/clawback flow that reverses credits and
downgrades a plan on a full refund. The accounting layer stays provider-agnostic: anything that calls
`grantCredits`/`setOrgPlan` moves the org's entitlement, and the scan code never imports the billing SDK._

## Plan tiers (`PLAN_FEATURES` in `src/lib/plans.ts`)

| Plan id | Shown as | Monthly price | Included scans/mo | Seats | Retention | Extra gates |
| --- | --- | --- | --- | --- | --- | --- |
| `free` | Free | $0 | 5 | 1 | 30 days | — |
| `pro` | **Starter** | $5 | 50 | 3 | 180 days | — |
| `team` | Team | $10 | 150 | 10 | 365 days | White-label briefings, Org Skills Library authoring, Shared Org Memory writes |
| `enterprise` | **Custom** | **Flexible** | Unmetered (`unlimited: true`) | Unlimited | Unlimited | Everything in Team, plus BYOM (bring-your-own-model) |

### Tier id vs tier label

**Two tiers are shown under a different name than they are stored under**: `pro` reads "Starter" and
`enterprise` reads "Custom". The ids are written to `Organization.plan`, named in `POLAR_PLAN_PRODUCTS`,
and ranked by the webhook's `PLAN_ORDER` comparison. Renaming one would mean migrating every persisted
org row plus a coordinated env edit on every deployment for no user-visible gain — so a tier reads its
`label` everywhere a human looks and keeps its `id` everywhere a machine looks.

Every surface that shows a tier's name or price derives it from the model rather than re-typing it —
`PlanControl` (the org plan switcher), the "Credits · Unlimited" chips (via the exported
`UNLIMITED_PLAN_LABEL`), the `/pricing` cards, the credit matrix (`MATRIX_PLANS` is now *built from*
`PLAN_FEATURES`, not a second copy of it), the `/pricing` SEO description and the landing FAQ.
`src/lib/plans.test.ts` pins the id↔label split so a rename can't quietly become a data migration, and
`price-drift.test.ts` derives its fixtures from `monthlyPrice` so a repricing can't break the drift
tests. The 2026-08-14 repricing found the last two prose copies — the landing FAQ and the `/pricing`
metadata both still quoted `Pro ($10/mo)` and `Team ($20/mo)`.

**The Custom tier is described by what is ADJUSTABLE, not by a list of unlimited things.** Its bullets
are the five dimensions a Custom contract scopes — hosting, scan volume, support, app customization,
SSO — which is also the checklist on the enquiry form. The previous copy ("Unlimited scans / Unlimited
members / Priority support") read as shipped entitlements when seats were never enforced and support
had no defined tier.

Notes, all read directly from the model:

- `monthlyPrice` on each tier is **display-only** — a duplicate of the Polar product's price for the
  `/pricing` page. A price change in the Polar dashboard must still be mirrored in `PLAN_FEATURES` by
  hand, but drift is now **detected**: `src/lib/price-drift.ts` fetches the live price of every
  `POLAR_PLAN_PRODUCTS`-mapped product and reports mismatches on the operator KPI route
  (`GET /api/kpi` → `priceDrift`, gated by `ASCENT_OPS_SECRET`; null when Polar is unconfigured).
- `includedCredits` is the monthly **metered-scan allowance** (private/org scans only — anonymous public
  scans are never metered and don't touch this). `null` means unmetered (the Custom tier).
- Feature gates are individual predicates, each defaulting unknown/blank plans to `free`:
  - `planAllowsWhiteLabel(plan)` — Team and Custom.
  - `planAllowsSkillsLibrary(plan)` — Team and Custom (authoring the Org Skills Library; reads stay
    open to all members).
  - `planAllowsMemory(plan)` — Team and Custom (writing to Shared Org Memory; reads stay open).
  - `planAllowsByom(plan)` — Custom only (connect the org's own LLM/Bedrock).
- `retentionCutoff(plan, nowMs)` gives the earliest scan date a plan's retention window includes (`null`
  for the Custom tier). It's a **non-destructive read floor** — history/trend/trajectory reads are
  clamped to it; nothing is ever deleted.
- `PLAN_ORDER = ["free", "pro", "team", "enterprise"]` is the cheapest→richest display/upgrade order, also
  used by the webhook's downgrade-guard rank comparison (see Refunds below).
- `planScanLine(plan)` is the **one** statement of a tier's monthly scan volume — the mono line above each
  price card's bullets. The bullets deliberately never restate it (`PlanFeature.features` says so, and a
  test enforces it): the same sentence in two typefaces read as two different facts.
- `planPriceLabel("enterprise")` is `{ amount: "Flexible", cadence: "scoped with you" }`. It used to be
  `"Custom" / "contact us"` — once the tier is *named* Custom, repeating the word as its price says nothing.
  `src/lib/price-drift.ts` still exempts the tier: `monthlyPrice` is null, so no number exists to drift.

## The hybrid charge model

Each **metered** scan (a real-inference scan against a private/org repo, gated by `isMeteredScan` in
`src/lib/entitlement.ts`) is billed by `resolveScanCharge` / the pure `decideScanCharge` in
`src/lib/plans.ts`:

```ts
export type ScanCharge = "unlimited" | "allowance" | "credit" | "denied";
```

1. **`unlimited`** — the org is on the Custom tier (`isUnlimitedPlan`); never charged.
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
- **Custom** — `unlimited: true`; never debited regardless of usage.

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

## Reaching checkout in-app (`/pricing`, G1-01)

The Starter/Team price cards on `/pricing` (`src/app/pricing/page.tsx`) render a real "Subscribe" checkout
link — `/api/billing/checkout?org=<slug>&pack=<planProductId>` — sourced from `planProducts()`, when ALL
of the following hold: Polar is configured (`polarEnabled()`), the tier has a `POLAR_PLAN_PRODUCTS`
mapping, and the signed-in viewer's primary org can be resolved (same precedence as the header's org-entry
link: custom-OAuth session, then the Supabase/dev viewer, then their highest-role membership). Any of
those being false — an anonymous visitor, a viewer with no org yet, or a deployment with no plan-product
catalog — degrades the CTA to the pre-existing "Get started" → `/onboarding` link (a real destination,
never a dead button); the org dashboard's `CreditsControl` offers the same checkout once the org exists.
The Free CTA is a scan link. The **Custom** tier's CTA is not a link at all — see below.

`ctaFor()` decides "this tier has no destination" from `PLAN_FEATURES[id].billing === "custom"`, not from
the literal `enterprise` id, and returns `null`; the card then renders `PlanEnquiryCta`. A Polar product
mapped to the tier does **not** turn it into a checkout link — a negotiated price is an operator's manual
fulfilment path, not something a visitor may buy from the page.

### The page itself (redesigned 2026-08-14)

The masthead is **one sentence plus the two real first moves** — "Scan a repo free" and "Explore the live
demo →" (the demo org is named beneath, with its `/org/<slug>` path, so "live demo" is a claim a visitor
can check). It replaced a paragraph that restated the entire metering model — free gate, briefing,
allowance, credits, top-ups — directly above the `CreditMatrixLedger` that explains all of it properly,
so a visitor had to read prose before finding anything to click. It spans the full card grid rather than
sitting in a narrow `max-w-2xl` column.

The four tiers render as a **`HairlineGrid`**, which [BRAND.md](../../../src/components/ui/BRAND.md)
names as the editorial-cluster treatment for exactly this ("levels, pricing, ledgers"): one framed ledger
with 1px rules between cells, not four floating `border-slate-800 bg-slate-900/40` cards. Prices are
`font-mono tabular-nums` per the brand's "numbers are typeset" principle, so `$10` / `$20` / `Flexible`
share a baseline across the cells.

Two details exist purely to keep the row **aligned**, and both are load-bearing — an inner rule that
stair-steps across four cells reads as a rendering fault: the cadence (`/ month`, `scoped with you`) gets
its own line rather than trailing the amount inline (inline, only `scoped with you` wrapped, making the
Custom cell a line taller), and the blurb has a three-line `min-h`. `planScanLine()` is kept short for the
same reason — `"… / mo included"` wrapped in every column, so the card supplies **Included** as a `Kicker`
label above it instead.

The "Most popular" pill on the Team card is gone: nothing in Ascent counts subscriptions, so it was an
unbacked popularity claim. Inside the hairline grid the emphasis is a **lit cell + accent eyebrow**
rather than a border — a per-cell border would fight the rules the grid is made of.

## Custom-plan enquiries (`POST /api/plan-enquiry`)

The Custom tier has no checkout, so `/pricing`'s highest-intent click opens a dialog
(`src/components/pricing/PlanEnquiryCta.tsx` + `PlanEnquiryFields.tsx`) that captures the requirement.
It replaces a CTA that was a `mailto:` when `ASCENT_CONTACT_EMAIL` happened to be set and "Learn more" →
`/about` when it wasn't — i.e. on a deployment without that env, a dead end.

- **One validator, both ends.** `normalizePlanEnquiry` (`src/lib/plan-enquiry.ts`) is pure and
  client-safe, and the modal and the route both run it — so the button can't enable a submission the
  server rejects, and the error strings are written once. Required: a name, a replyable email, and a
  ≥10-char message. Optional fields degrade rather than fail: an unknown fleet size becomes `""`, an
  over-long company/message is truncated, unknown `areas` ids are dropped. Anything else in the body is
  ignored, so a client can't smuggle `viewerLogin` or `emailStatus` into the row.
- **The five areas** (`ENQUIRY_AREAS`: hosting · scans · support · customization · sso) are the same five
  the price card advertises — the card and the form read one list, rendered as `CheckCard` tiles.
- **The dialog is on the brand form kit** (`Field` / `TextInput` / `SelectInput` / `TextArea` /
  `CheckCard` from `@/components/ui`), which this change introduced — see
  [design-system/README.md](../design-system/README.md#form-controls-srccomponentsuifieldtsx). It sets
  no border or background of its own.
- **Guards**, outermost first: `requireSameOrigin` (this is a browser form, never an API), then
  `CONTACT_RATE_LIMIT` via `rateLimitRequestShared` (3/min/IP, 30/min global — an unauthenticated endpoint
  that sends mail is a spam cannon aimed at one inbox), then an off-screen honeypot field (`website`),
  which is answered with the same `{ ok: true }` shape a real submission gets so a spammer learns nothing.
- **Store, then notify.** The `PlanEnquiry` row *is* the lead; the mail is a notification about it. A
  persist failure is logged and the send still runs; `emailStatus` (`sent` | `skipped` | `failed`) is
  stamped on the row afterwards. Only the case where **both** failed returns an error (503) — otherwise
  telling the submitter "we got it" would be a lie. `viewerLogin`/`orgSlug` are resolved server-side.
- **The mail** (`src/lib/email/plan-enquiry.ts`) goes to `ASCENT_SALES_EMAIL` with the **prospect as
  `replyTo`**, so the operator answers by hitting Reply. It's the first operator-inbound message in the
  email module, so its required footer says exactly that instead of pretending there's a list to leave.

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
  `grantCredits` directly (dev/manual top-up path, same accounting as the webhook). Two bounds sit above
  it, because "owner" is the top authorization tier and a self-serve mint has no role to appeal to:
  - **Production hard-disable** — `creditGrantsEnabled()` (`src/lib/env.ts`) returns `false` whenever
    `NODE_ENV === "production"`, *regardless of the env var*, exactly like `authBypassEnabled()`. A
    leaked, misconfigured, or staging-reused `ASCENT_ALLOW_CREDIT_GRANTS` therefore cannot open a credit
    mint on a real deployment; in production, credits move only via the Polar webhook.
  - **Lifetime grant cap** — `LIFETIME_GRANT_CAP` (1,000,000 credits, ten times the per-call clamp)
    bounds the **net total** an org may ever mint here, measured from the persisted ledger via
    `sumManualGrants`. The per-call `|amount| <= 100_000` clamp bounds one call; without a cumulative
    bound, repeated calls summed to an unbounded total. A positive grant that would cross the cap is
    refused with 403 + `{ granted, cap }`; debits/corrections are never blocked. Deliberately a code
    constant, not an env var — a cap the leaked environment could raise would be no cap at all.

## Low-balance warning (the opt-in "auto-recharge" preference)

A paying org whose prepaid balance hits 0 used to discover it only from the `paused` chip (or the next
402) — autoscans stall mid-week and nobody is told until someone looks. The counter-measure is an
**opt-in low-balance warning** with a one-click top-up, armed per org.

**What it is NOT.** Ascent cannot auto-recharge in the literal sense. The Polar integration is a *hosted
checkout redirect* plus a *signed fulfilment webhook*; nothing stores a payment method or a Polar
customer session, and no off-session charge API is used. Buying credits therefore always requires a
present human. The constant `AUTO_RECHARGE_CHARGES_AUTOMATICALLY`
(`src/components/org/shared/CreditsControl.autorecharge.ts`) is hard-wired `false`, every "we top up for
you" string in the UI is gated on it, and the endpoint returns it as `chargesAutomatically` — so the
product cannot drift into promising a purchase that would silently never happen. **The one genuinely
recurring top-up that exists is a Polar *subscription* whose product is also a credit pack: its renewal
`order.paid` grants credits every cycle (see the webhook above). That is calendar-driven, not
balance-driven.**

- **The preference** — `{ enabled, threshold, packProductId }`. `enabled` is the switch (default
  **off**); `threshold` is the balance at which to warn (1…10,000, default **5**, matching
  `CREDITS_ALERT_THRESHOLD` so the in-app warning and the Slack low-credit push agree); `packProductId`
  is the pack the one-click top-up offers.
- **Where it lives** — `Organization.autoRechargeJson`, a real column (JSON-in-TEXT, matching
  `gatePolicy`). Read and written through **`src/lib/db/org-settings.ts`** (`getOrgAutoRecharge` /
  `setOrgAutoRecharge`) — every surface that needs the preference (the credits popover, this route, the
  low-credit alert) goes through that accessor rather than touching storage.

  It previously lived in the **audit trail**: each save appended a `billing.autorecharge` `AuditLog` row
  and the most recent one *was* the preference. That worked, but it cost a `findMany` per read and put a
  customer setting inside a table the retention purge is allowed to delete. The audit row is still
  written on every change — as an audit record of *who* changed a billing-adjacent setting and *when*,
  which is a feature in its own right. **No backfill was run**: `getOrgAutoRecharge` falls back to the
  legacy audit row while the column is NULL, so an org that configured a threshold before the migration
  keeps it, and the next save moves it into the column.
- **`GET /api/billing/autorecharge?org=`** — read-gated; returns `{ pref, chargesAutomatically, source }`
  where `source` is `"stored"` or `"default"`. A missing/unreadable preference degrades to the default,
  which is **off** — failing to read a warning setting must never invent a warning.
- **`PUT /api/billing/autorecharge`** — owner-gated + same-origin. An out-of-range `threshold` is a 400
  (not a silent clamp); a failed **column** write is a **503, never `ok: true`**. A failed *audit* write
  is logged but no longer fails the save — the customer's setting is already durably persisted, so
  reporting failure would be the lie in the other direction.
- **The boundary** — `creditPressure({ balance, allowanceRemaining, pref })` returns one of
  `paused` (balance 0 **and** allowance spent) · `covered` (balance 0, monthly allowance still paying) ·
  `low` (balance still **positive** and `<= threshold`) · `ok`. `low` is the only state the preference
  can produce and it requires `enabled`, so an org that never opts in sees byte-identical behaviour to
  before the feature existed. At 0 the harder `paused`/`covered` states win — they say more.
- **In the UI** — `CreditsControl`'s popover renders the amber "Running low — N credits left … private
  scans pause at 0" notice with a direct `/api/billing/checkout` link for the chosen pack, plus the
  opt-in toggle itself.

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
- `sumManualGrants(org)` sums the ledger rows the manual grant path writes (`grant` + `adjustment`,
  net) and nothing else — Polar top-ups, scan debits, refunds and clawbacks are excluded, so purchases
  never consume manual-grant headroom and spending granted credits never frees any. It is the persisted
  basis for the grant endpoint's lifetime cap.
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
ASCENT_ALLOW_CREDIT_GRANTS=  # enables POST /api/org/credits/grant (owner-gated manual top-up); IGNORED under NODE_ENV=production
ASCENT_ALLOW_PLAN_CHANGES=   # enables POST /api/org/plan to set a paid/unlimited tier directly (bypassing checkout)
ASCENT_SALES_EMAIL=          # where Custom-plan enquiries are mailed; defaults to the operator address in src/lib/email/plan-enquiry.ts
RATE_LIMIT_CONTACT_PER_IP=3  # enquiry-form budget per IP per minute
RATE_LIMIT_CONTACT_GLOBAL=30 # …and the per-instance ceiling
```

Enquiry mail rides the shared email transport, so it needs a provider — `RESEND_API_KEY` (simplest) or
`SES_FROM_EMAIL`. With neither, the enquiry is still **stored** and the response reports
`emailed: false`. See [alerts.md](../fleet/alerts.md#email-transport) for the provider selection.

`LLM_INPUT_COST_PER_MTOK` / `LLM_OUTPUT_COST_PER_MTOK` (see [usage.md](usage.md)) turn recorded token usage
into a $ estimate on `/usage` — useful for calibrating pack/plan prices against real inference cost.

## Known gaps

- **Price drift is detected, not fixed** — `src/lib/price-drift.ts` reconciles `monthlyPrice` against the
  live Polar prices on demand (`GET /api/kpi` → `priceDrift`), but the correction is still a manual edit
  to `PLAN_FEATURES`, and nothing pushes the alert — an operator has to pull the KPI route to see it.
- **Allowance boundary is a soft gate** — `countMeteredScansThisMonth` is a non-atomic read, so concurrent
  scans crossing the monthly-allowance boundary can overshoot the free allowance by a small, bounded
  amount (never paid credits, which are hard-gated). A fully atomic bound would need a monthly-usage
  counter (schema change).
- **Stale out-of-order tier resurrection** — the `order.paid` stale-paid fence only catches an event whose
  *own* payload shows the subscription already lapsed; a redelivery carrying a stale but still-"active"
  snapshot would still apply. The revoke/refund handlers are the authoritative correction for this case.
- **What `/pricing` advertises but nothing enforces** (audited 2026-08-14 against every `planAllows*`
  predicate and every plan comparison in the codebase). The **metered** half of the pricing page is real —
  allowance, credits, unlimited tier, retention — and so are four capability gates
  (`planAllowsWhiteLabel`, `planAllowsSkillsLibrary`, `planAllowsMemory`, `planAllowsByom`, plus the
  undocumented `planAllowsPdfExport` at Pro+). These are the claims with **no code gate behind them**:

  | Claim on `/pricing` | Reality |
  | --- | --- |
  | Seats — "1 / 3 / 10 members", Custom "yours to set" | `PlanFeature.seats` is read by **nothing**. No membership-write path, invite route, or `authz` check consults it. Previously logged here as "unconfirmed"; now confirmed unenforced. |
  | Org fleet dashboard — Starter and up | No plan check anywhere under `/org/**`. A Free org gets the whole dashboard. |
  | Scheduled autoscans + alerts — Starter and up | `org-watch.ts`, the rescan cron and `alerts.ts` have no plan gate. A Free org can schedule autoscans; only the *scans* they trigger are metered, not the capability. |
  | Segments + comparisons — Team | `src/lib/db/segments.ts` has no plan check. |
  | Playbooks + planning — Team | No plan check. |
  | Buy extra scan credits — matrix says Starter and up | Checkout and `CreditsControl` have no tier gate; a Free org can buy credits. (Arguably the right behaviour — the *matrix* is what's wrong.) |

  Two claims were **corrected rather than logged**, because they asserted capabilities that don't exist at
  all: the matrix's "SSO · RBAC · audit logs ✓" (roles and the audit trail ship; **SAML/OIDC sign-in does
  not** — login is GitHub OAuth via Supabase) and the old Custom-tier bullet "Priority support" (no support
  tiering exists anywhere). The SSO row now reads "Scoped", which is what the enquiry form is for.

  Closing the rest is a product decision, not a bug fix: either enforce the gates (each needs a predicate
  in `plans.ts` plus a call site, and seats additionally needs a count-vs-limit check on the invite/accept
  path) or restate the bullets as what they are — capabilities included at every tier.
- **Email receipts** — Polar sends its own; Ascent doesn't send a separate one.
- **No off-session charging (blocks true auto-recharge)** — the low-balance feature above stops at a
  *warning + one-click top-up* because this integration has no stored payment method and no Polar
  customer-session / off-session charge path. Closing this needs (a) persisting the Polar customer id at
  checkout, (b) a saved-method / customer-session capability confirmed on the Polar plan in use, and
  (c) a server-side trigger (the debit path in `consumeScanCredit`, or the rescan cron) that fires the
  charge — plus its own idempotency key so a retry can't double-bill. Until all three exist,
  `AUTO_RECHARGE_CHARGES_AUTOMATICALLY` must stay `false`.
- **The warning is UI-only** — `creditPressure` is evaluated in the credits popover, so an org that
  never opens it relies on the existing Slack low-credit push (`maybeAlertLowCredits`, global
  `CREDITS_ALERT_THRESHOLD`), which does **not** yet read the per-org `threshold` stored here.
