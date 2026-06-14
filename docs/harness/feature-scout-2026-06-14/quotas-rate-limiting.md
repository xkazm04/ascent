# Feature Scout — Quotas & Rate Limiting (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 2H / 3M / 0L

## 1. The blocked-scan moment has no paid upgrade path — the funnel dead-ends
- **Severity**: Critical
- **Category**: user_benefit
- **File**: src/lib/public-scan-quota.ts:262-264, src/components/report/QuotaNotice.tsx:48-53
- **Scenario**: A user burns through their free weekly public scans (anon: 3, signed-in: 20). They hit the wall mid-evaluation, motivated and ready to pay — the single highest-intent moment in the whole funnel.
- **Gap**: The 429 message only says "try again once the window resets," and `QuotaBlocked` offers exactly two actions: "Sign in for a higher limit" (anonymous only) and "← Back home". A signed-in user who exhausts their 20 gets a pure dead-end — no CTA at all (`canOfferSignIn` returns false for scope `"user"`). Grep confirms NO upgrade surface exists anywhere: no `/pricing`, `/upgrade`, or `/billing` page (only `/api/org/credits/grant`, an owner-gated manual grant), no Stripe checkout (`docs/BILLING.md` calls the purchase flow "design-stage"), and `paymentRequired()` (entitlement.ts:36) likewise returns a bare 402 with no buy link. The freemium gate converts nobody.
- **Impact**: This is THE conversion lever. The blocked moment is where free intent becomes revenue; today it leaks 100% of high-intent users. Benefits the business directly (every funnel exit is lost ARR) and the user (a frustrated wall vs. a one-click path to keep going).
- **Fix sketch**: Add an `upgradeHref`/`buyCreditsHref` prop threaded into `QuotaBlocked`/`QuotaStaleNotice`/`QuotaBanner`, and a real `/pricing` (or `/billing`) page with a "Buy scan credits" CTA that begins a Stripe Checkout session (the credits ledger + `grantCredits()` webhook hook in credits.ts:48 are already built for this). Even a stopgap mailto/"request credits" form beats the current dead-end. ~Medium effort (UI + one route + Stripe session); enormous ROI.

## 2. Rate limiter is per-instance in-memory — no distributed/durable backstop
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/rate-limit.ts:29 (`const windows = new Map`), 1-10 (scope comment)
- **Scenario**: ascent deploys to serverless/multi-instance (Next.js 16 on Vercel/Lambda). An abusive client hammers `/api/scan` (a GitHub ingest + LLM completion = real $) across N instances, or instances cold-start and reset their windows mid-attack.
- **Gap**: The limiter's state is a module-global `Map`, explicitly "PER SERVER INSTANCE." The file's own header and `docs/PRODUCTION_READINESS.md` (Wave 2) flag the Redis/Upstash backing as not-yet-done. Effective global limit becomes `instances × limit`, and a cold start wipes every window. The persistent weekly quota (public-scan-quota.ts) is Prisma-backed precisely because it can't tolerate this, but the per-minute burst limiter — the actual abuse backstop — still can.
- **Impact**: Protects LLM spend (the core cost driver) and keeps the abuse cap honest at scale. Benefits the business (bounded inference cost under attack) and ops (predictable spend). Required for any real production scale-out.
- **Fix sketch**: Introduce an async `RateLimitStore` interface with the existing in-memory impl as default and an Upstash Redis (`INCR`/sliding-window) impl behind an env flag; make `rateLimitRequest` await the store. The `hit()` window logic ports directly. ~Medium effort; isolated to one module + its 4 call sites.

## 3. No live "scans left" meter before the user commits to a scan
- **Severity**: High
- **Category**: feature
- **File**: src/app/page.tsx:74-80 (static limits only), src/components/report/QuotaNotice.tsx:103 (`QuotaBanner` — post-scan only)
- **Scenario**: A returning user lands on the home/scan entry and wants to know "how many free scans do I have left this week?" before spending one on a repo they're unsure about.
- **Gap**: The remaining-count is only ever surfaced AFTER a scan completes, via the `x-ascent-quota-*` response headers parsed in ReportClient.tsx:167. The home page (page.tsx:74) shows only the STATIC policy limits ("3 free scans a week"), never the user's live remaining balance. Grep confirms no GET/peek endpoint exists — `consumePublicScanQuota` is the only reader and it CONSUMES a slot; there is no read-only "how many left" query.
- **Impact**: Reduces wasted/anxious scans, sets expectations, and creates a natural, repeated upgrade nudge ("1 of 3 left — get 20 by signing in / buy credits"). Benefits users (transparency) and the business (a low-pressure conversion touchpoint shown every visit, not just at the wall).
- **Fix sketch**: Add `peekPublicScanQuota(req, identity)` (read-only `decideQuota` without the upsert) + a tiny `GET /api/quota` that returns `{ remaining, resetAt, scope, limit }`; render a meter on the home/scan entry (reuse `QuotaBanner`'s copy). ~Small effort; the window math + headers already exist.

## 4. Only two hardcoded quota tiers — no mid-funnel paid quota plan
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/public-scan-quota.ts:43-57 (`publicScanWeeklyLimit` / `signedInScanWeeklyLimit`)
- **Scenario**: A power user or small team needs more than 20 public scans/week but doesn't want the private-repo prepaid-credit model. There's no offering between "free signed-in (20)" and "buy private credits."
- **Gap**: The quota system supports exactly two env-driven limits (anon default 3, signed-in default 20). There is no per-plan dimension — `QuotaIdentity` carries only `viewerId`, never a plan, and `consumePublicScanQuota` never consults `getCreditState`/plan (entitlement.ts is a separate code path for private scans only). A "Pro public" tier with a higher weekly cap can't be expressed.
- **Impact**: Captures the middle of the willingness-to-pay curve — heavy public-scan users who'd pay for headroom but aren't private-repo customers. Benefits the business (new revenue tier) and prosumers (a plan that fits their usage).
- **Fix sketch**: Extend `QuotaIdentity` with an optional `plan`/`tier`, add a `planScanWeeklyLimit(plan)` resolver, and have `consumePublicScanQuota` pick the limit by plan (defaulting to the signed-in/anon tiers). Reuses the existing per-user bucket. ~Small-Medium effort; depends on a plan field being readable for the viewer.

## 5. Badge route ships a duplicate, divergent in-memory limiter
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:48-72 (`const hits = new Map`, `rateLimited()`)
- **Scenario**: A maintainer's README badge is hit by many viewers; the badge route triggers the same expensive `scanRepository()` and needs the same abuse protection as `/api/scan`.
- **Gap**: The badge route hand-rolls its OWN `Map`-based per-IP limiter (`hits`, `rateLimited()`) instead of importing the shared `rateLimitRequest`/`SCAN_RATE_LIMIT` from rate-limit.ts. rate-limit.ts:9-10 even acknowledges this ("The badge route ships its own copy of this pattern"). Two copies means any hardening from finding #2 (distributed store) silently skips the badge endpoint, and the configs/cleanup logic drift independently.
- **Impact**: Closes a coverage hole — when the limiter is upgraded to be distributed, the badge route inherits it for free. Benefits ops (one limiter to reason about) and cost control (consistent caps on every scan-triggering route).
- **Fix sketch**: Replace the bespoke `hits`/`rateLimited()` with `rateLimitRequest(req, SCAN_RATE_LIMIT)` (or a dedicated `BADGE_RATE_LIMIT` config), preserving the badge's "render a 'rate limited' SVG instead of 429" behavior at the call site. ~Small effort; pure consolidation.

## 6. Quota purge is wired to retention, but no usage/quota observability exists
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/public-scan-quota.ts:286 (`purgeStalePublicScanQuota`), src/lib/rate-limit.ts:66 (no metrics emitted)
- **Scenario**: An operator wants to know how often the free gate trips, how many anonymous vs. signed-in buckets are active, and whether the limits are tuned right (too tight = lost conversions, too loose = wasted LLM spend).
- **Gap**: `consumePublicScanQuota` and `rateLimitRequest` make allow/deny decisions but emit NO metric, event, or audit signal on a 429/quota trip (grep shows only `console.error` on store failures). There's no dashboard or counter for quota-block rate, and `weeklyQuotaExceeded`/`tooManyRequests` fire blind. The retention purge (purgeStalePublicScanQuota) is the only operational hook on the table.
- **Impact**: Turns the gate from a black box into a tunable funnel instrument — operators can A/B the weekly limit against conversion and abuse. Benefits the business (data-driven limit tuning = more revenue or less cost) and ops (early signal of an attack or a mis-set limit).
- **Fix sketch**: Emit a lightweight metric/event (the codebase already has an `events`/usage layer) on every quota deny and rate-limit trip, tagged by scope (anon/user) and route; surface counts on the existing `/usage` page. ~Small-Medium effort; instrumentation only, no behavior change.
