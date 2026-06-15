# Billing — prepaid scan credits

_Status: **implemented end-to-end** — the credit system and the **Polar purchase flow** (sandbox by default: a checkout route + a signature-verified, idempotent fulfilment webhook). The accounting layer stays provider-agnostic: anything that calls `grantCredits` tops up the balance, and the scan code never imports the billing SDK._

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
| Polar config + pack catalog | `src/lib/polar.ts` (`POLAR_CREDIT_PACKS`) |
| Checkout (buy a pack) | `GET /api/billing/checkout?org=&pack=` |
| Fulfilment webhook | `POST /api/billing/webhook` — signature-verified, idempotent → `grantCredits(…, { reason: "polar", externalId })` |
| "Buy credits" UI | the org-dashboard credits popover (`CreditsControl`) |

Credits are granted by calling `grantCredits(orgSlug, amount, { reason, actor, externalId })`. The
callers are the owner-gated dev endpoint, seeds, and the **Polar fulfilment webhook** — the accounting
layer doesn't care who tops up the balance. Pass `externalId` (the Polar order id) to make a grant
idempotent, so an at-least-once webhook can retry without ever double-crediting.

### Consumption safety

`consumeScanCredit` uses a conditional decrement (`UPDATE … WHERE scanCredits > 0`), so two concurrent
scans can never drive the balance negative; under Aurora DSQL serialization the loser retries
(`withRetry`). The gate checks entitlement **before** running paid inference and debits **after**, so a
failed/aborted scan isn't charged.

## Polar top-up flow (implemented)

Purchases run through [Polar](https://polar.sh) — **sandbox by default** (`POLAR_SERVER`). The scan code
never imports the billing SDK; it only ever sees `grantCredits`.

**Credit packs** are the product→credits map in `POLAR_CREDIT_PACKS` (comma-separated `<productId>=<credits>`
pairs, e.g. `prod_abc=100,prod_def=500,prod_ghi=2000`). This one list — read by `src/lib/polar.ts` — is the
source of truth for both what the "Buy credits" UI offers and how many credits a paid order grants, so the
amount is decided by the **product purchased**, never by anything the client sends.

Flow:

1. **Checkout.** `GET /api/billing/checkout?org=<slug>&pack=<productId>` validates the pack against the
   catalog (an unknown product id is rejected), creates a hosted Polar checkout with the org carried in
   `externalCustomerId` + `metadata`, and 303-redirects the browser to it. No credits move here, so the
   GET needs no CSRF/owner gate — the trust boundary is the webhook signature.
2. **Fulfilment via webhook.** `POST /api/billing/webhook` (the `@polar-sh/nextjs` `Webhooks()` adapter)
   verifies the signature against `POLAR_WEBHOOK_SECRET`, then on `order.paid` resolves the org (from
   `customer.externalId`, falling back to `metadata.org`) and the credits (from the product) and calls
   `grantCredits(org, credits, { reason: "polar", actor: "polar", externalId: "polar:<orderId>" })`.
3. **Idempotency.** The grant keys on the Polar order id (`CreditLedger.externalId`, UNIQUE), so a
   webhook redelivery is a no-op. The webhook fails **closed** when `POLAR_WEBHOOK_SECRET` is unset.
4. **Auto-recharge.** A Polar **subscription** product also emits `order.paid` on each billing cycle, so
   listing a recurring product in `POLAR_CREDIT_PACKS` tops the org up automatically every cycle — no
   extra code.
5. **Reconciliation.** `CreditLedger` rows with reason `polar` (and `externalId` = the order id)
   reconcile against Polar orders.

### Setup (sandbox)

1. Create a Polar account + Organization and switch it to the **sandbox** environment.
2. Create an **Organization Access Token** (sandbox) → `POLAR_ACCESS_TOKEN`.
3. Create **one product per credit pack** (e.g. 100 / 500 / 2000 credits), via the Polar dashboard or
   the [`@polar-sh/cli`](https://github.com/polarsource/polar). Map each returned product id to the
   credits it grants in `POLAR_CREDIT_PACKS`.
4. Add a **webhook** (sandbox) targeting `{host}/api/billing/webhook`, subscribe to **`order.paid`**, and
   copy its signing secret → `POLAR_WEBHOOK_SECRET`.

```
POLAR_ACCESS_TOKEN=          # server-side Polar Organization Access Token (sandbox)
POLAR_WEBHOOK_SECRET=        # verifies POST /api/billing/webhook signatures
POLAR_SERVER=sandbox         # sandbox (default) | production
POLAR_CREDIT_PACKS=prod_abc=100,prod_def=500,prod_ghi=2000
```

### Pricing knobs that already exist

`LLM_INPUT_COST_PER_MTOK` / `LLM_OUTPUT_COST_PER_MTOK` (see `src/lib/db/usage.ts`) turn recorded token
usage into a $ estimate on `/usage`. Set each pack's Polar price so one credit comfortably covers the
average private scan's inference + service cost; the `/usage` data is the basis for calibrating it.

## Not in scope (future)

- Subscription **tiers** as first-class plans (recurring credit packs already work via `order.paid`; a
  richer plan↔seat model could layer on later).
- Seat-based pricing / SSO — Enterprise-custom today (see RBAC in `src/lib/db/members.ts`).
- Email receipts (Polar sends its own; Ascent doesn't yet).
