# Checkout & Plans (Polar) — Bug + UI Scan
> Context: Checkout & Plans (Polar) (Billing, Credits & Metering)
> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)

## 1. Refund clawback under-reverses on sequential / partial-then-full refunds
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: money-error
- **File**: src/app/api/billing/webhook/route.ts:74-99 (key at :92, fraction at :85-87)
- **Value**: impact 8 · effort 5 · risk 3
- **Scenario**: A buyer purchases a 500-credit pack, then refunds it in two steps: a 30% partial, later the remaining 70% (a full refund). Polar's `order.refundedAmount` is **cumulative** ("Amount refunded in cents"; the SDK exposes a separate `refundableAmount` that "accounts for previous refunds"). The first refund webhook claws back `round(500 * 0.30) = 150` and writes ledger row `polar-refund:<order.id>`. The second webhook computes `fraction = refundedAmount/gross = 1.0` but `grantCredits` short-circuits on the existing `externalId` and applies **nothing**. Net: 150 of 500 credits clawed back though 100% was refunded — the buyer keeps 350 free credits (and the scans they bought). The same applies to any N>1 partial refunds.
- **Root cause**: The idempotency key `polar-refund:${order.id}` is per-**order**, but `refundedAmount` is per-**event cumulative**. One order legitimately emits multiple refund events with growing amounts; the key collapses them all into the first. The header comment even admits "multiple SEPARATE partial refunds ... only reverse the first increment", but the bug also breaks the headline full-refund case whenever any partial preceded it.
- **Impact**: Money error / refund abuse — credits (and paid private scans) survive a full refund.
- **Fix sketch**: Make the key event-distinct and claw the **delta**: target = `round(packCredits * cumulativeFraction)`, then apply `target - alreadyClawed`. E.g. key on the refund id if present, or on the cumulative amount (`polar-refund:${order.id}:${order.refundedAmount}`) and grant only the marginal clawback. That makes the whole class (any sequence of refunds) reconcile to the true refunded fraction.

## 2. No billing path upgrades the plan tier — paid checkout only grants credits
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/app/api/billing/webhook/route.ts:31-65 · src/app/api/billing/checkout/route.ts:1-62 · src/app/api/org/plan/route.ts:5
- **Value**: impact 8 · effort 7 · risk 4
- **Scenario**: A user on /pricing chooses "Pro" or "Team" and follows the documented flow to buy. The checkout (`checkout/route.ts`) creates a Polar session for a **credit pack** only; the webhook's `onOrderPaid` calls `grantCredits` and nothing else. `setOrgPlan` is invoked from exactly one place — the manual, env-gated owner override at `/api/org/plan` — and from **no** billing path (verified by grep). So a paying customer receives credits but stays on the `free` plan: 10/mo allowance instead of Pro's 100, 1 seat instead of 3, 30-day retention instead of 180, and no white-label/BYOM. Meanwhile `plan/route.ts:5` asserts "the real paid upgrade flows through billing checkout (CRED-1)" — which the code does not implement.
- **Root cause**: Plan tier and the credit economy were built as two systems; the checkout/webhook wired only credits, leaving the tier reachable solely via the manual `ASCENT_ALLOW_PLAN_CHANGES` override. The in-code comments describe a fulfilment path that doesn't exist.
- **Impact**: Advertised tier benefits are unreachable by payment; expectation/money mismatch (pay for Pro, get free-plan limits). Core purpose of this context ("paid-plan upgrade path") is non-functional.
- **Fix sketch**: Either (a) map Polar subscription/product → plan and call `setOrgPlan` in `onOrderPaid`/an `onSubscription*` handler, or (b) if plans are deliberately credit-only for now, correct the misleading comments and make /pricing's Pro/Team CTAs route to the credit purchase, not imply a tier upgrade.

## 3. Unauthenticated checkout GET enumerates orgs and creates real Polar sessions
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/app/api/billing/checkout/route.ts:20-39, 51-57
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: The route is GET with no auth/CSRF gate (deliberate, per the comment). An anonymous caller hitting `/api/billing/checkout?org=acme&pack=<valid-pack>` gets a distinct **404 echoing the org name** ("Unknown organization \"acme\"…") when the slug doesn't exist, versus a **303 redirect** when it does — a clean oracle to enumerate which org slugs exist. Worse, for every existing org the GET calls `polar.checkouts.create`, so each probe (or a browser/link prefetcher, crawler, or chat-unfurl bot following the link) mints a real remote Polar checkout session — a side-effecting GET that can be spammed.
- **Root cause**: The "no state change, so no gate needed" rationale is false: creating a Polar checkout *is* an external state change, and the differentiated 404-vs-303 responses leak existence to unauthenticated callers.
- **Impact**: Org-existence enumeration (info disclosure) + remote resource creation/abuse on an unauthenticated GET (prefetch-triggerable, cost/rate-limit pressure on Polar).
- **Fix sketch**: Make this a POST behind same-origin (mirroring `/api/org/plan`), or at minimum return a uniform generic error for unknown-org vs other failures so existence isn't leaked, and guard against prefetch (the create should only run on an explicit user action).

## 4. /pricing conversion CTAs are dead-ends / mislabeled
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/app/pricing/page.tsx:75-80
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: Every non-free card links to `/connect`. The Enterprise card's button reads "Contact us" but goes to `/connect` (the repo-watch page) — there is no contact form or `mailto`, so the user never reaches anyone. Pro/Team read "Get started" but also land on `/connect`, which is neither a checkout nor a plan upgrade — the page's own header comment says credits/plans are managed "from the org dashboard (CreditsControl → Polar)". So the primary conversion CTAs on the money page lead to an unrelated screen.
- **Root cause**: A single `href={id === "free" ? "/" : "/connect"}` ternary stands in for three distinct intents (scan free / buy / contact sales).
- **Impact**: Lost conversions and user confusion on the highest-intent page; "Contact us" misrepresents what the button does.
- **Fix sketch**: Route each tier to its real destination — Free → "/", Pro/Team → the org dashboard credits/checkout entry (or sign-in→that), Enterprise → a real contact path (`mailto:`/contact page). Label each button to match where it goes.

## 5. Highlighted "Team" plan has no textual cue; decorative ✓ not hidden from SR
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/app/pricing/page.tsx:50-73
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: `highlight = id === "team"` adds an accent ring/border but no label — sighted users get no reason why Team is emphasized, and screen-reader users get no signal at all (the ring is purely visual). Separately, each feature bullet prefixes a `✓` glyph with no `aria-hidden`, so a screen reader announces "check mark" before every line item across four cards.
- **Root cause**: Visual-only emphasis carrying meaning, and a decorative glyph left in the accessibility tree.
- **Impact**: Minor a11y/clarity degradation on a key marketing page.
- **Fix sketch**: Add a visible "Most popular"/"Recommended" badge on the highlighted card (also exposed to AT), and mark the `✓` `aria-hidden="true"` (the adjacent text already conveys the feature).
