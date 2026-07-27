# Quotas & Rate Limiting — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Client-IP trust model assumes exactly one well-behaved proxy — undocumented, and the 30-day quota inherits the failure modes
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/lib/rate-limit.ts:17` (clientIp), `src/lib/public-scan-quota.ts:110` (bucketContext)
- **Scenario**: `clientIp` trusts `x-real-ip` unconditionally, then the RIGHT-most `x-forwarded-for` hop. Two unstated deployment assumptions: (a) the platform strips/sets `x-real-ip` — on a self-hosted deploy behind a proxy that forwards client headers verbatim, an attacker sends a fresh `x-real-ip` per request and mints unlimited per-minute buckets AND unlimited 30-day quota buckets (plus one `PublicScanQuota` DB row per spoofed value); (b) there is exactly ONE trusted proxy — behind a two-hop chain (CDN → LB), the right-most XFF hop is the CDN edge IP, so thousands of real users collapse into a handful of stable buckets. For the burst limiter that's a nuisance; for the persistent monthly quota it's a month-long lockout of the whole anonymous funnel — precisely the failure the `unidentifiable`/"unknown" carve-out (public-scan-quota.ts:103-111) was built to avoid, but that carve-out only fires on the literal `"unknown"` sentinel, not on a shared proxy IP that looks like a valid client.
- **Root cause**: The header-trust decision is encoded but the deployment precondition it depends on (single trusted proxy, platform-controlled `x-real-ip`) is recorded nowhere — not in the module comment, not in an env knob, not in docs/PRODUCTION_READINESS.md's rate-limit section.
- **Impact**: On any non-Vercel-shaped deploy the quota system silently degrades to either fully bypassable (spoofed `x-real-ip`) or falsely exhausted for everyone (shared edge IP) — both invisible until users report "quota exceeded on my first scan" or the cost guardrail stops guarding.
- **Fix sketch**: Add a trusted-proxy knob (e.g. `ASCENT_TRUSTED_PROXY_HOPS` or an allowlisted platform-header mode, as kp did with `KP_TRUSTED_PROXY`), document the single-proxy assumption at `clientIp`'s doc comment, and have `bucketContext` treat a configured "IP is not client-unique here" flag like `unidentifiable` (fail-open for the monthly gate) instead of bucketing a shared proxy IP for 30 days.

## 2. GET /api/quota is the only public endpoint with no rate limit — an unauthenticated per-request DB read
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/app/api/quota/route.ts:14`
- **Scenario**: Every other public surface (`/api/scan`, `/api/scan/stream`, `/api/org/import`, `/api/gate/*`, `/api/badge/*` — even the cheap cache-only peek probe got its own `PEEK_RATE_LIMIT` with an explicit amplification rationale) passes through `rateLimitRequest`. `/api/quota` does not: each anonymous request runs `getViewer()` (auth resolution) plus a `publicScanQuota.findUnique` against the shared DB, with `cache-control: no-store` guaranteeing no CDN absorption, and the client-side `QuotaMeter` re-fires it on every focus/visibility/pageshow event.
- **Root cause**: The route was added to power the meter and inherited "read-only ⇒ harmless" thinking; the module comments that justified throttling the /report peek probe ("no-cost amplification lever") were never applied to this sibling.
- **Impact**: A trivial loop turns the free funnel's cheapest endpoint into a DB-connection/read amplifier (Aurora DSQL bills per request), and legitimate tab-switch storms from many visitors add unmetered load — while the operator's quota-event observability records nothing, because only limited paths bump counters.
- **Fix sketch**: Add a generous `QUOTA_PEEK_RATE_LIMIT` (e.g. 60/min/IP like PEEK) with `rateLimitRequest` + `tooManyRequests`; the meter already tolerates a non-OK response (renders nothing / keeps last state), so a 429 is safe client-side.

## 3. "Weekly" terminology survives in operator-facing comments and types while the gate is a rolling 30-day month
- **Severity**: Medium
- **Category**: stale-documentation
- **File**: `src/lib/db/quota-events.ts:2` (also :25), `src/app/api/quota/route.ts:2`, `src/lib/rate-limit.ts:136`
- **Scenario**: The quota is a rolling 30-day window (`public-scan-quota.ts:46`, all user copy says "this month"). But quota-events.ts describes itself as counting "a weekly-quota denial" and labels `quotaDenies` as "Weekly free-scan denials"; /api/quota's header comment says "how many free public scans are left this week"; rate-limit.ts's PEEK comment says "WITHOUT consuming the weekly free-scan quota". These are the exact comments an operator reads when interpreting the /usage abuse counters or tuning `PUBLIC_SCAN_MONTHLY_LIMIT`.
- **Root cause**: The window was migrated from weekly to monthly (the module rename to `publicScanMonthlyLimit` shows the change) but the three dependent files' prose was not swept.
- **Impact**: An operator reading "weekly denials" on the /usage view mentally divides deny counts by the wrong window (≈4× error) when judging whether the limit needs tuning — the stated purpose of the counters. Future contributors may also re-derive constants from the wrong horizon.
- **Fix sketch**: s/week(ly)?/month(ly)/ in the three files' comments and the `QuotaEventTotals.quotaDenies` doc line; grep for remaining `week` mentions near quota code to confirm the sweep.

## 4. Pre-scan QuotaMeter and post-scan report banners disagree on the anonymous upsell — meter never offers the sign-in CTA
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/components/QuotaMeter.tsx:72` (vs `src/components/report/QuotaNotice.tsx:110`)
- **Scenario**: For an anonymous caller, QuotaNotice's shared `quotaCta` establishes a deliberate hierarchy: "Sign in for more" (Supabase-gated, primary) first, "See plans →" as fallback. The landing-page QuotaMeter — the FIRST quota surface a visitor meets — shows only "upgrade for more scans" → /pricing, never the sign-in option, even though its own comment claims it "Matches the report banner's link style so the two quota surfaces read as one system". The link *style* matches; the *action* contradicts the established hierarchy. It also shows the paid upsell even when the visitor still has their full allowance (remaining = limit).
- **Root cause**: The meter was built against the banner's visual pattern but not its `canOfferSignIn`/`quotaCta` logic, which lives in QuotaNotice and wasn't reused (only `formatResetAt` was imported).
- **Impact**: The cheapest conversion step (sign in → elevated per-user bucket, decoupled from a shared CGNAT IP) is invisible exactly where the user decides whether to scan; the two surfaces present different "what do I do about the limit" answers, and a full-allowance visitor gets a premature "upgrade" nudge.
- **Fix sketch**: Export `quotaCta`/`canOfferSignIn` from QuotaNotice (or lift both into a shared module) and use them in QuotaMeter for `scope === "anon"`; consider suppressing the upsell entirely while `remaining === limit`.

## 5. formatResetAt fabricates "in a few days" when the reset time is unknown
- **Severity**: Low
- **Category**: magic-number
- **File**: `src/components/report/QuotaNotice.tsx:31`
- **Scenario**: When `resetAt` is null/non-finite, `formatResetAt` returns the literal "in a few days", so blocked users read "your free monthly limit is used; it resets in a few days". A just-exhausted 30-day window actually resets up to ~30 days out — the copy can be off by a factor of ten. All three consumers (QuotaBlocked message path, QuotaStaleNotice, QuotaBanner "last scan" state) can hit it; only QuotaMeter guards `resetAt` before calling.
- **Root cause**: A placeholder fallback chosen for tone ("coarse — a day is precise enough") without recording why "a few days" is an acceptable claim when the true horizon is unknown but bounded by WINDOW_MS. This repo's own standard (see monthlyQuotaExceeded's comment about the hardcoded "5") treats inaccurate numbers on the upgrade prompt as "a user-facing untruth".
- **Impact**: A user who returns "in a few days" trusting the banner finds the limit still tripped — eroding trust in the exact surface designed to convert or retain them.
- **Fix sketch**: Make the unknown case honest and vague-in-the-right-direction: return "when the window resets" / "within 30 days", or omit the reset clause entirely when `resetAt` is null (as QuotaMeter already does).
