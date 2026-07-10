# Checkout & Plans (Polar) — bug-hunter + ui-perfectionist scan

> Context: Checkout & Plans (Polar) (group: Billing, Credits & Metering)
> Files scanned: 6
> Total: 7 findings (Critical: 0, High: 2, Medium: 4, Low: 1)

## 1. Revoke a plan tier when its subscription is cancelled or refunded
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: missing-downgrade
- **File**: src/app/api/billing/webhook/route.ts:97
- **Scenario**: An org is put on Pro/Team by a paid `order.paid` (or by the manual `/api/org/plan` override). Later the buyer cancels the subscription, or refunds/charges back the plan order. Polar fires `subscription.canceled`/`subscription.revoked` (unhandled — the route only wires `onOrderPaid`/`onOrderRefunded`), and for a pure plan product `onOrderRefunded` hits `if (packCredits <= 0) return;` (line 97) and does nothing. `setOrgPlan(org, plan)` is only ever called in the *upgrade* direction.
- **Root cause**: The assumption that a tier is a one-way, permanent grant — the same append-only trap the credit clawback (added right below) was built to fix, but never closed for plans. Upgrade has a billing path; downgrade/revoke has none.
- **Impact**: Money/entitlement leak. A customer keeps Pro/Team (100–500 monthly allowance, seats, retention, white-label, BYOM at Enterprise) indefinitely after they stop paying or reverse the charge. Every cancellation is a permanent free upgrade.
- **Fix sketch**: Add `onSubscriptionCanceled`/`onSubscriptionRevoked` handlers that `setOrgPlan(org, "free")` (idempotent), and in `onOrderRefunded` downgrade the tier when `planForProduct(order.productId)` is set and the refund fraction ≥ 1. Bind the org via `orderOrg` / the subscription's customer external id.

## 2. The paid tier-upgrade funnel is unreachable from the UI
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: unwired-purchase-funnel
- **File**: src/app/pricing/page.tsx:30
- **Scenario**: A visitor on `/pricing` wants Pro ($10) or Team ($20) and clicks "Get started" — which `ctaFor` points at `/onboarding` (line 30), not at any checkout. The checkout route *accepts* plan products (`route.ts:59` `planForProduct(pack)`) and the webhook *applies* the tier (`setOrgPlan`), but the only link to `/api/billing/checkout` in the whole app is CreditsControl.tsx:191, and it only ever passes a **credit-pack** `productId`. Nothing — not `/pricing`, not `/onboarding`, not CreditsControl — ever hits checkout with a `POLAR_PLAN_PRODUCTS` id.
- **Root cause**: The plan-purchase capability was built end-to-end on the server (the webhook comment even says "Previously NO billing path called setOrgPlan, so a paying customer stayed on free") but the client entry point was never wired, so the checkout's plan branch is dead and the "Get started" CTA leads nowhere that can charge.
- **Impact**: Lost revenue / broken primary monetization path — a user who wants to pay for Pro/Team cannot, in-app. (If plans are instead sold on Polar's hosted storefront, then the checkout route's plan branch is dead code and `/pricing` should link to that storefront — either way it's a wiring defect.)
- **Fix sketch**: Either point the Pro/Team CTA at `/api/billing/checkout?org=…&pack=<planProductId>` (server-render the plan product ids like CreditsControl does for packs), or, if selling externally, link the CTA to the Polar storefront and drop the plan branch from the checkout route.

## 3. Post-checkout `?credits=pending|error` status is never surfaced
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/billing/checkout/route.ts:91
- **Scenario**: On success Polar returns the buyer to `/org/<org>?credits=pending` (line 84); on a failed session-create the route redirects to `/org/<org>?credits=error` (line 91). The org overview (`org/[slug]/page.tsx:44`) awaits `searchParams` but only reads it via `resolveOrgWindow`/`resolveOrgScope` (range + segment) — a repo-wide grep finds **no** consumer of `?credits=`. Both statuses are dead.
- **Root cause**: The redirect assumes a landing page renders the status; none does. The producer and consumer of the query flag drifted apart.
- **Impact**: UX degradation + hidden failure. After paying, the user lands on the dashboard with zero "payment received / credits pending" confirmation (they'll wonder if it worked); worse, a checkout that *failed to even start* dumps them on the same page with no error at all — success theater on both branches.
- **Fix sketch**: Read `sp.credits` in the org layout/page and render a dismissible banner: pending → "Payment received, credits arrive shortly"; error → "Checkout couldn't start, try again." Reuse the existing toast/alert primitive.

## 4. `polarEnabled()` needs a credit pack, blocking subscription-only deployments
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: config-gap
- **File**: src/lib/polar.ts:93
- **Scenario**: A deployment configures `POLAR_ACCESS_TOKEN` + `POLAR_PLAN_PRODUCTS` (sells subscription tiers) but leaves `POLAR_CREDIT_PACKS` empty. `polarEnabled()` returns `polarToken() !== null && creditPacks().length > 0` → `false`, so the checkout route 503s at line 43 for *every* product, including valid plan products.
- **Root cause**: `polarEnabled()` equates "billing is on" with "at least one credit pack exists," predating plan products; it never learned that a plan-only catalog is also sellable.
- **Impact**: A valid subscription-only configuration has checkout entirely disabled — no purchases of any kind — with a "Billing is not configured" 503 that misdescribes the state.
- **Fix sketch**: `return polarToken() !== null && (creditPacks().length > 0 || planProducts().length > 0);` and, if kept for the UI, split a `creditsEnabled()` for the "Buy credits" panel.

## 5. A DB blip during checkout is reported as "Unknown organization"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-masking
- **File**: src/app/api/billing/checkout/route.ts:67
- **Scenario**: `if (isDbConfigured() && !(await getOrgId(org).catch(() => null)))` — `getOrgId` throws on a transient DB error (connection reset, pool exhaustion). The `.catch(() => null)` collapses that throw into `null`, indistinguishable from "org not found," so the route returns 404 "Unknown organization. Create it before purchasing credits."
- **Root cause**: Conflating *lookup failed* with *does not exist*. A momentary infra fault is presented as a permanent, actionable user error.
- **Impact**: During a DB hiccup a legitimate owner is told their org doesn't exist and is instructed to re-create it — a confusing, purchase-blocking dead end on the money path. (The uniform-message anti-enumeration goal is preserved by returning a 503 instead.)
- **Fix sketch**: Distinguish the two: `let exists; try { exists = await getOrgId(org); } catch { return 503 "temporarily unavailable"; }` then 404 only when `exists` is genuinely null.

## 6. Subscription prices are hardcoded in the frontend and can drift from the real charge
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: price-drift
- **File**: src/lib/plans.ts:50
- **Scenario**: `plans.ts` sets `monthlyPrice: 10` (pro, line 50) and `20` (team, line 62); `/pricing` renders these as the headline via `planPriceLabel`, and `pricing/page.tsx:38` *also* hardcodes "Pro $10/mo, Team $20/mo" in the SEO `metadata.description`. Yet the file header states "Pricing itself lives in the billing provider (Polar) … no dollar amounts are invented here" — and the actual amount charged is whatever the Polar product is priced at.
- **Root cause**: Two/three independent price sources (plans.ts, the metadata string, and Polar) with no single source of truth, contradicting the module's own stated contract. Change the Polar price and the displayed price silently lies.
- **Impact**: The pricing page (and search snippet) can advertise a price different from what a customer is charged — a trust/refund/consumer-law hazard, and a maintenance landmine.
- **Fix sketch**: Treat Polar as the price authority: fetch the product price for display (or, if kept static, derive the metadata string from `planPriceLabel` so at least the on-page and meta figures share one source and are reviewed together).

## 7. Pricing CTAs skip the shared `.focus-ring` token
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: design-system-adherence
- **File**: src/app/pricing/page.tsx:21
- **Scenario**: `CTA_CLASS` (lines 20–21) has `transition hover:bg-accent/20` but no focus treatment. `globals.css:197` defines `.focus-ring` as "one consistent, visible focus ring for **every** interactive element," and the sibling billing UI uses it (CreditsControl.tsx:192 buy-credit links, the dialog at :165). The `/pricing` plan CTAs opt out.
- **Root cause**: The CTA class predates / bypasses the shared focus token, so keyboard focus on the plan buttons falls back to the inconsistent browser default instead of the accent ring used everywhere else.
- **Impact**: Minor a11y/consistency gap — a keyboard user tabbing the pricing CTAs gets a different (or missing, depending on UA) focus indicator than the rest of the app.
- **Fix sketch**: Prepend `focus-ring` to `CTA_CLASS` (`"focus-ring mt-4 rounded-lg …"`), matching CreditsControl's buy links.
