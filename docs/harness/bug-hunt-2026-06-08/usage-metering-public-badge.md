# Bug Hunter — Usage Metering & Public Badge (ascent)

> Total: 7 findings (Critical: 1, High: 2, Medium: 3, Low: 1)
> Files read: 11
> Scope: /usage, /api/usage, db/usage, /api/badge/[owner]/[repo]

## 1. Public badge leaks PRIVATE repo maturity via the server's GITHUB_TOKEN
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:269 (and src/lib/scan.ts:100)
- **Scenario**: A deploy sets `GITHUB_TOKEN` to a PAT that can read the operator's private repos (a very common setup — the badge route itself reads `process.env.GITHUB_TOKEN` at line 253 to resolve heads, and the rate-limit copy at github/source.ts:261 actively tells operators to add one). An unauthenticated attacker requests `GET /api/badge/<org>/<private-repo>`. The badge calls `scanRepository("<org>/<private-repo>", { mock: true })` and passes **no** `token` in opts; inside `scanRepository`, `const token = opts.token ?? process.env.GITHUB_TOKEN` (scan.ts:100) silently uses the server PAT. GitHub returns the private repo's tree/files, the scan succeeds, and the endpoint renders an SVG advertising the private repo's maturity level (e.g. "● L5 Autonomous"). Repeating across guessed repo names enumerates private maturity scores.
- **Root cause**: `mock: true` only forces the *LLM provider* to mock — it does NOT disable GitHub ingestion, and the token fallback to the ambient server credential means the public, unauthenticated badge inherits whatever private access that PAT has. There is no `report.repo.isPrivate` gate before serving the badge value.
- **Impact**: info leak (private repo scores exposed to anonymous internet)
- **Fix sketch**: Make the public surfaces token-less by construction — pass `{ mock: true, token: undefined }` explicitly (never fall back to the ambient PAT on badge/gate), AND refuse to render a value when `report.repo.isPrivate` is true (serve the neutral "private" badge). One token-less scan source for all public endpoints.

## 2. Per-IP rate limit is trivially bypassed via a spoofed X-Forwarded-For
- **Severity**: High
- **Category**: code_quality
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:45-49 (clientIp), 263 (gate)
- **Scenario**: `clientIp()` returns `req.headers.get("x-forwarded-for").split(",")[0]` — the FIRST, client-supplied segment of a header any caller can set. An attacker sends each request with a fresh `X-Forwarded-For: <random>` and every request keys a brand-new bucket, so `rateLimited()` always sees `recent.length === 1` and never trips. They then drive unlimited `scanRepository()` calls against unique `owner/repo` combos (the negative cache only helps *repeated* misses, not unique ones), each doing 3+ GitHub REST calls.
- **Root cause**: trusting the left-most XFF entry as the client identity. The left-most value is attacker-controlled; only a trusted-proxy-appended right-most hop is reliable, and that's deployment-specific.
- **Impact**: DoS (unbounded expensive scans) + GitHub rate-limit exhaustion (breaks scanning app-wide) + cost
- **Fix sketch**: Derive the client IP from a trusted source only (platform header like the hosting provider's real-client header, or the Nth-from-right XFF hop given a known proxy count); never key off the raw left-most XFF. Fail closed (treat unknown as one shared bucket) rather than minting a fresh bucket per spoofed value.

## 3. 429 / "rate limited" and "unknown" badges are served with a 10-minute public cache
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:192-199 (respond), 264-267 (429), 312 (unknown)
- **Scenario**: `respond()` always sets `cache-control: public, max-age=600, s-maxage=600`, including for the 429 rate-limited badge and the transient-failure "unknown" badge. When a repo's README badge URL is hit during a brief GitHub blip (or while one noisy IP is over budget), the 429/"unknown" SVG is cached by the shared CDN under that URL. For the next 10 minutes *every* viewer of that README sees "rate limited"/"unknown" even though the repo is fine and the blip has cleared. A 429 is explicitly a transient, per-IP state being cached as if it were the canonical repo result.
- **Root cause**: one blanket cache policy applied to success, throttle, and error responses alike. A negative/throttle response must not share the long public TTL of a real result.
- **Impact**: silent failure / UX (badges stuck showing a wrong transient state for 10 min across all viewers)
- **Fix sketch**: Branch the cache header by outcome — `no-store` (or a few-second max-age) for 429 and transient "unknown"; the long `public, s-maxage` only for a genuine resolved level. The existing `retry-after` already signals the 429 is ephemeral; the cache header must agree.

## 4. Badge SVG response is CDN-cacheable but its body varies by query params with no Vary/key discipline
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:192-199, 210-217 (style/label/color/logo/gate)
- **Scenario**: The response body depends on `?style`, `?label`, `?color`, `?logo`, and `?gate` (custom label/color are reflected into the SVG). The endpoint is `force-dynamic` yet returns `public, s-maxage=600` with no `Vary`. CDNs/proxies that normalize or drop query strings (or are configured to key on path only) will serve the first cached variant — e.g. one consumer's `?label=Trust%20me&color=brightgreen` customized badge — to subsequent requesters for the same `owner/repo` path, and a `?gate` pass/fail badge can be served for a non-gate request (or vice versa).
- **Root cause**: a per-query-customized body advertised as a path-cacheable public resource, relying on every intermediary to key on the full URL including query.
- **Impact**: cache poisoning / wrong badge content served cross-consumer
- **Fix sketch**: Either drop the long public cache on any request that carries customization params, or fold the customizing params into a cache key the platform respects (and verify the CDN keys on full query). Don't advertise `public` caching for a body that varies on uncontrolled query input.

## 5. Metering bills mock / keyless scans as private "billable" units
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/db/usage.ts:104 (priv count), src/app/usage/page.tsx:117,140
- **Scenario**: `privateScans` counts every persisted `Scan` whose `repo.isPrivate === true`, with no filter on whether the scan actually consumed paid LLM work. A private repo scanned with no LLM key (or after an LLM failover to the deterministic mock — scan.ts:240 sets `engineProvider` to "mock", token usage 0) still writes a Scan row with `isPrivate` repo, so it lands in `privateScans` and is presented on /usage as "Billable (private)" (page.tsx:117 `const billable = usage.privateScans`). The usage-based plan ("each private scan is a metered unit") therefore charges for scans that cost nothing and may have produced only deterministic-floor scores.
- **Root cause**: "billable" is derived purely from repo visibility, conflating *a computed scan row* with *a paid/LLM-backed metered unit*; the mock-degrade path is invisible to metering.
- **Impact**: wrong billing (overcount — customers charged for free/mock scans)
- **Fix sketch**: Define the billable predicate explicitly (e.g. private AND `engineProvider != 'mock'`, or AND tokens > 0) in one place and count that, rather than equating `privateScans` with billable volume.

## 6. estimatedCost can render "$0.00" as a real charge, and a zero-but-configured rate masks the "rate not set" state
- **Severity**: Medium
- **Category**: code_quality
- **File**: src/lib/db/usage.ts:128-133, src/app/usage/page.tsx:148-154
- **Scenario**: Cost is computed only when `inRate > 0 || outRate > 0`. If exactly one of `LLM_INPUT_COST_PER_MTOK` / `LLM_OUTPUT_COST_PER_MTOK` is set (the other unset → 0 via `envNumber(...,0)`), cost is computed using a 0 for the missing side — silently undercounting spend (e.g. output tokens billed at $0) while the UI confidently shows a dollar figure "from configured rates". Conversely, a period with real tokens but a deliberately-0 configured rate shows `$0.00` indistinguishable from "no spend", and a period with tokens recorded as 0 (all-mock period) shows `$0.00` as if it were a measured, rate-backed charge.
- **Root cause**: a single `> 0` OR-gate can't distinguish "fully configured", "partially configured", and "intentionally free"; a 0 default for an unset rate is treated as a valid price.
- **Impact**: wrong billing (silent undercount when only one rate set) / misleading UX ($0.00 shown as a real estimate)
- **Fix sketch**: Require BOTH rates present (and ≥ 0) before estimating; treat an unset rate as `null`, not 0; surface "rate not set" whenever either side is missing so a partial config can't quietly halve the bill.

## 7. /api/usage and /usage are fully unauthenticated when auth is not configured
- **Severity**: Low
- **Category**: functionality
- **File**: src/app/api/usage/route.ts:52 (`if (isAuthConfigured() && ...)`) , src/app/usage/page.tsx:63
- **Scenario**: Both the IDOR gate (route.ts:52) and the page sign-in gate (page.tsx:63) are wrapped in `if (isAuthConfigured())`. `isAuthConfigured()` is false unless `GITHUB_OAUTH_CLIENT_ID` + `_SECRET` + `AUTH_SECRET` are all set (auth.ts:83). A production deployment that has `DATABASE_URL` (so metering is live and multi-tenant via the GitHub App) but has NOT configured OAuth — an easy partial-config — exposes `GET /api/usage?org=<any-slug>` to anyone, letting them enumerate org slugs and read each tenant's scan volume, timeline, token spend, and top repo names with zero authentication.
- **Root cause**: the auth gate is conditional on auth being configured, which is correct for the local/demo single-tenant story but becomes an open multi-tenant data endpoint under a realistic partial prod config (DB on, OAuth off).
- **Impact**: info leak (cross-tenant usage/volume/repo-name enumeration) under misconfiguration
- **Fix sketch**: When `DATABASE_URL` is set but auth is not, restrict the usage API to the single shared "public" org only (refuse any other `org=` slug), so DB-on-auth-off cannot serve per-tenant data — decouple "is this multi-tenant data" from "is auth turned on".
