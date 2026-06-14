# Feature Scout — Credits & Entitlements (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. Self-serve credit purchase (Stripe Checkout) — the missing revenue path
- **Severity**: Critical
- **Category**: functionality
- **File**: docs/BILLING.md:38 (design-only); src/app/api/org/credits/grant/route.ts:3
- **Scenario**: An org owner runs out of private-scan credits, hits a 402, opens the credits popover — and there is no way to buy more. They cannot give the product money.
- **Gap**: The entire accounting layer (grant/consume/ledger/402) is shipped, but the *purchase* flow is design-stage only. Grep confirms ZERO Stripe wiring in `src/`: no `/api/billing/checkout`, no `/api/billing/webhook`, no `BillingProvider`, no `stripeCustomerId` column, no `STRIPE_*` env consumed (the only matches are in docs/`.env.example` design notes). Today credits enter ONLY via `POST /api/org/credits/grant`, which is owner-gated AND disabled unless `ASCENT_ALLOW_CREDIT_GRANTS=1` — its own header warns a self-serve grant "would let an owner mint free scans." So in production there is literally no way to add credits. This blocks all revenue.
- **Impact**: Every paying customer. This is the product's monetization on/off switch — without it the prepaid model generates $0. The whole BILLING.md contract was written precisely so this could be added without touching scan code.
- **Fix sketch**: Implement the documented `BillingProvider` abstraction (real Stripe adapter + deterministic mock, mirroring the LLM-provider pattern). Add `Organization.stripeCustomerId` (additive migration). `POST /api/billing/checkout {org, pack}` (owner-gated, reuse `requireOrgRole`/`isSameOrigin`) → hosted Checkout Session → redirect URL. `POST /api/billing/webhook` verifies signature, on `checkout.session.completed` calls the existing `grantCredits(org, packCredits, {reason:"stripe", actor:"stripe"})` — idempotent on the Stripe event id. Wire CreditsControl's buttons to checkout. ~2-3 days incl. tests + webhook idempotency.

## 2. Activate the `pro`/`team` plan tiers (plan gating + self-serve up/downgrade)
- **Severity**: High
- **Category**: feature
- **File**: prisma/schema.prisma:29; src/lib/db/credits.ts:12
- **Scenario**: A growing org wants "more" than free but less than a bespoke enterprise contract — included monthly credits, higher retention, more seats. The schema advertises `free | pro | team | enterprise`, but choosing `pro` or `team` does nothing.
- **Gap**: The `plan` column carries four values, yet `isUnlimitedPlan()` special-cases ONLY `enterprise`; grep for `"pro"`/`"team"` in entitlement/credits/usage finds NO references (the `"team"` hits are an unrelated repo-archetype enum). There is no plan-feature table, no monthly credit allotment, no way for a user to change plan (no `changePlan`/`setPlan`/`upgrade` endpoint), and no plan-comparison surface. The middle tiers are inert marketing.
- **Impact**: Mid-market orgs — the segment most likely to convert to recurring revenue. Tiers turn one-off credit packs into predictable MRR and give a natural upgrade ladder (the homepage at src/app/page.tsx:265 even references "the free-account upgrade" that doesn't exist).
- **Fix sketch**: Add a `PLAN_FEATURES` map (`src/lib/plans.ts`) defining included monthly credits / retention / seat caps per tier; have `getCreditState`/entitlement read it. Add `POST /api/org/plan` (owner-gated) that flips the tier (and, with finding #1, opens a Stripe subscription for the monthly allotment). A small `PlanComparison.tsx` on the org settings page. ~2 days for gating + endpoint; pricing UI on top.

## 3. Auto-recharge (low-balance automatic top-up)
- **Severity**: High
- **Category**: feature
- **File**: docs/BILLING.md:82 ("Not in scope (future)"); src/lib/alerts.ts:247
- **Scenario**: An org schedules daily autoscans across its fleet, balance silently drains, and one morning every scheduled scan is skipped with `insufficient_credits` — maturity trends flatline. The owner only finds out via a Slack ping, after the gap.
- **Gap**: Grep for `auto.?recharge`/`rechargeThreshold`/`top.?up.?threshold` returns NOTHING. The system has all the prerequisites — a low-water-mark crossing detector (`isLowCreditsCrossing`, `maybeAlertLowCredits`) fires at depletion — but it only *notifies*; it never *refills*. The reserve-then-refund cron path (`src/app/api/cron/rescan/route.ts:105`) makes silent depletion especially likely for watched fleets.
- **Impact**: Every org on a recurring scan cadence — the highest-value, highest-retention users. Auto-recharge converts the prepaid model's "silent churn moment" (alerts.ts:243 names it explicitly) into uninterrupted service and steadier revenue. This is table-stakes for prepaid SaaS (Stripe, OpenAI, Twilio all offer it).
- **Fix sketch**: Add `Organization.autoRechargeThreshold` + `autoRechargePack` columns (additive migration). In `maybeAlertLowCredits` (or a dedicated hook on `isLowCreditsCrossing`), when balance ≤ threshold and a saved Stripe payment method exists, trigger an off-session charge via the #1 `BillingProvider`, then `grantCredits(..., {reason:"auto-recharge"})`. Depends on #1. ~1.5 days once Stripe exists.

## 4. Credit-pack catalog with real prices at the point of purchase
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/components/org/CreditsControl.tsx:136
- **Scenario**: An owner opens the credits popover to buy more and sees bare buttons "+50 / +200 / +1000" — with no dollar price, no per-credit rate, no "best value" framing. They can't make an informed spend decision.
- **Gap**: The pack amounts are hardcoded raw integers in the component (`[50, 200, 1000].map(...)`) with no price attached; grep finds no `CREDIT_PACK`/pricing catalog anywhere client- or server-side. BILLING.md anticipates `STRIPE_PRICE_PACK_SMALL/MEDIUM/LARGE` but no catalog module exposes pack→price→credits to the UI. The "Pricing knobs" (`LLM_*_COST_PER_MTOK`) only feed the `/usage` $ estimate, never a buy-side price.
- **Impact**: Anyone purchasing credits. A clear pack ladder with $ amounts and per-credit savings raises average top-up size and reduces purchase hesitation — standard pricing-page conversion lift.
- **Fix sketch**: Add `CREDIT_PACKS` to `src/lib/plans.ts` (`{id, credits, priceUsd, label}`), shared by CreditsControl, the onboarding commitment surface, and the #1 checkout route. Render price + per-credit rate + a "best value" badge in the popover. ~0.5 day (pure data + UI), then wire to checkout.

## 5. Surface credit runway/burn forecast on the credits chip itself
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/components/org/CreditsControl.tsx:122; src/app/usage/page.tsx:155
- **Scenario**: An owner glances at the "47 credits" chip in the org header. Is that a week of runway or six months? They'd have to navigate to `/usage` to learn — the chip itself answers "how many" but never "for how long."
- **Gap**: Runway IS computed — `/usage/page.tsx:155` derives `runwayDays = balance / dailyBurn` and renders "≈ Nd at current burn." But that forecast lives only on the usage page. `CreditsControl` (the always-visible chip + popover, the actual decision-and-top-up surface) shows a static integer and a binary low/not-low state — no runway, no burn rate, despite `estimateMonthlyCredits` (the watched-fleet commitment forecast) already existing as a pure, reusable function.
- **Impact**: Every org owner. Putting "≈ 12 days left at current burn" next to the top-up buttons turns a number into a decision, prompting timely top-ups before depletion (proactive vs. the reactive 402). Pure surfacing of work already done.
- **Fix sketch**: Extend `GET /api/org/credits` to return the same `dailyBurn`/`runwayDays` math (lift it out of usage/page.tsx into a shared `creditRunway()` helper, reuse `getUsageSummary`'s billable count). Render the runway line in the CreditsControl popover header. ~0.5 day.

## 6. Email receipts and email low-balance notifications
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/alerts.ts:242 (Slack-only); docs/BILLING.md:82
- **Scenario**: A finance owner tops up 1000 credits and expects a receipt for expense records; a less-Slack-centric org wants the low-balance warning to reach a billing inbox, not a chat channel they may not watch.
- **Gap**: All credit lifecycle notifications go through ONE sink — a Slack-compatible webhook (`buildLowCreditsMessage` → `resolveAlertWebhook`). Grep for `invoice`/`receipt` finds only docs and unrelated audit-log strings; there is no email transport, no purchase receipt, no PDF/line-item invoice. BILLING.md explicitly lists "email receipts" as future. Orgs without a Slack webhook configured get NO proactive credit notification at all.
- **Impact**: Finance/procurement stakeholders at paying orgs (who rarely live in Slack) and any org needing spend documentation. Receipts are an expected, often required, part of a paid product; email widens notification reach beyond Slack-native teams.
- **Fix sketch**: Add an email transport (`src/lib/email.ts`, e.g. Resend/SES) behind a provider abstraction like the alert sink. On `grantCredits(reason:"stripe")`, send a receipt with pack, $ amount, and balanceAfter (data already in the ledger row). Add email as a second channel in the low-credits crossing alongside the Slack push. ~1.5 days incl. a templated receipt.
