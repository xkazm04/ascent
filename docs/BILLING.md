# Billing — prepaid scan credits

_Status: the **credit system is implemented**; the **Stripe purchase flow is design-stage** (not wired). This doc is the contract between the two so the gate stays provider-agnostic and Stripe can be added without touching scan code._

## Model

Ascent monetizes **private** repository scans with **prepaid credits**. There is no subscription.

- **Public scans** — free and unmetered, forever.
- **Private scans** (installation-token scans against a real org) — each scan that runs real LLM
  inference **debits one credit**. A cache/dedup hit or a degrade-to-mock run is **not** charged.
- **Enterprise** plan (`Organization.plan = "enterprise"`) — unlimited; never debited.

## What's implemented

| Piece | Location |
|---|---|
| Balance + plan | `Organization.scanCredits`, `Organization.plan` |
| Ledger (append-only audit) | `CreditLedger` (delta, balanceAfter, reason, repoFullName, scanId, actor) |
| Accounting (grant/consume/balance/ledger) | `src/lib/db/credits.ts` |
| Entitlement policy + 402 | `src/lib/entitlement.ts` |
| Gate on the single scan | `src/app/api/scan/route.ts` (402 up front, debit after real inference) |
| Gate on bulk + cron | `src/app/api/org/scan/route.ts` (scans up to balance, reports the rest as skipped) |
| Read balance/ledger | `GET /api/org/credits?org=` |
| Manual/dev grant | `POST /api/org/credits/grant` — owner-only, gated behind `ASCENT_ALLOW_CREDIT_GRANTS` |

Credits are granted by calling `grantCredits(orgSlug, amount, { reason, actor })`. Today the only
callers are the owner-gated dev endpoint and seeds. **Stripe will call the same function** — the
accounting layer doesn't care who tops up the balance.

### Consumption safety

`consumeScanCredit` uses a conditional decrement (`UPDATE … WHERE scanCredits > 0`), so two concurrent
scans can never drive the balance negative; under Aurora DSQL serialization the loser retries
(`withRetry`). The gate checks entitlement **before** running paid inference and debits **after**, so a
failed/aborted scan isn't charged.

## Stripe top-up flow (design — not implemented)

A `BillingProvider` abstraction mirrors the LLM-provider pattern (a real adapter + a deterministic
mock), so the routes never import the Stripe SDK directly.

```
interface BillingProvider {
  createTopUpCheckout(org, pack): Promise<{ url }>   // hosted Stripe Checkout (one-time payment)
  handleWebhook(rawBody, signature): Promise<{ org, creditsGranted } | null>
}
```

Flow:

1. **Customer mapping.** First purchase creates a Stripe Customer; store its id on the org (a new
   `Organization.stripeCustomerId` column — additive migration, not yet added).
2. **Checkout.** `POST /api/billing/checkout { org, pack }` → owner-gated → creates a one-time
   Checkout Session for a credit pack (e.g. 100 / 500 / 2000 credits) and returns the redirect URL.
3. **Fulfilment via webhook.** `POST /api/billing/webhook` verifies the Stripe signature and, on
   `checkout.session.completed`, calls `grantCredits(org, packCredits, { reason: "stripe", actor: "stripe" })`.
   Idempotency: key on the Stripe event id (skip if already processed) so retries don't double-grant.
4. **Reconciliation.** The `CreditLedger` (reason `stripe`, actor `stripe`) reconciles against Stripe
   payments.

### Env (design)

```
STRIPE_SECRET_KEY=            # server-side Stripe API key
STRIPE_WEBHOOK_SECRET=        # verifies POST /api/billing/webhook signatures
STRIPE_PRICE_PACK_SMALL=      # price id per credit pack
STRIPE_PRICE_PACK_MEDIUM=
STRIPE_PRICE_PACK_LARGE=
```

### Pricing knobs that already exist

`LLM_INPUT_COST_PER_MTOK` / `LLM_OUTPUT_COST_PER_MTOK` (see `src/lib/db/usage.ts`) turn recorded token
usage into a $ estimate on `/usage`. Set a credit price so one credit comfortably covers the average
private scan's inference + service cost; the `/usage` data is the basis for calibrating it.

## Not in scope (future)

- Subscription tiers and metered/usage billing (the model could be added alongside credits later).
- Seat-based pricing / SSO — Enterprise-custom today (see RBAC in `src/lib/db/members.ts`).
- Automatic low-balance top-up and email receipts.
