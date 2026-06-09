# Bug Hunter Scan — Usage Metering & Public Badge (ascent)

> Total: 7 findings (Critical: 0 | High: 2 | Medium: 3 | Low: 2)

## 1. Unbounded `?label=` (and `?logo=`) inflates the public SVG — amplification / cache-poisoned giant badge
- **Severity**: High
- **Category**: untrusted-input / resource-exhaustion
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:233, 237, 241
- **Scenario**: If an anonymous caller requests `GET /api/badge/facebook/react?label=<100KB of A's>` (or a multi-megabyte `?logo=data:image/...`), then the route emits an SVG whose `width`/text content scales with the caller-supplied string with no upper bound. `customLabel` is taken verbatim (`label = customLabel ?? defaultLabel`) and only `esc()`'d — never length-capped — and `logo` accepts any `data:image/...` string of arbitrary size and embeds it whole via `href="${esc(opts.logo)}"`.
- **Root cause**: The hardening assumed the *path* params were the only attacker-controlled input and validated those tightly (`validName`), but the query params that feed directly into the rendered body have no size or character ceiling.
- **Impact**: Response amplification (tiny request → huge response) on a public, unauthenticated endpoint embedded in READMEs; a `width="NaN"`/absurd width also produces a broken or screen-filling badge. `textW` does `s.length * charW`, so a 1 MB label yields a multi-million-px wide `<svg width=...>`.
- **Fix sketch**: Cap `customLabel`/`customColor`/`logo` lengths early (e.g. `label.slice(0, 64)`, reject `logo.length > ~8KB`), and clamp the computed `w`/`lw`/`vw` to sane maxima before rendering.

## 2. `validName` accepts leading/embedded dots (`..foo`, `a..b`, `.git`) the comment claims it blocks
- **Severity**: Medium
- **Category**: validation-gap / untrusted-input
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:33-37
- **Scenario**: If a crawler requests `/api/badge/..foo/a..b` or `/api/badge/.git/.git`, then `validName` passes it: the regex `^[A-Za-z0-9_.-]+$` permits leading dots and consecutive dots, and the only exclusions are the exact strings `"."` and `".."`. The comment ("never '.'/'..'") implies path-traversal-style segments are rejected, but only the two bare forms are.
- **Root cause**: The check rejects the two literal dot segments but not the broader class of dot-laden names GitHub itself forbids; the validator is laxer than its own documented intent.
- **Impact**: These names flow into `scanRepository(\`${ownerN}/${repoN}\`)` and into the click-through `href` path `/report/${ownerN}/${repoN}`. No traversal escapes the URL path here (they're single segments), but it widens the set of inputs that reach the scan/cache layer and the negative cache, enabling more distinct-key enumeration than intended. Low security blast radius, but a real validation/intent mismatch.
- **Fix sketch**: Tighten to GitHub's actual grammar: forbid a leading dot and reject any name matching `/\.\./` (or simply `!s.includes("..") && !s.startsWith(".")`).

## 3. Stale badge: `CACHE_RESOLVED` pins a level for 10 min, but a fresh push isn't detected when head resolution fails
- **Severity**: Medium
- **Category**: stale-cache / silent-degradation
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:278-283, 207
- **Scenario**: If `resolveHeadWithHint` returns `null` (transient GitHub blip, missing `GITHUB_TOKEN`, rate-limited head lookup), then `sha` is null, the key degrades to the SHA-less `owner/repo::mock` form, and the resulting (possibly outdated) report is served with `CACHE_RESOLVED` = `public, max-age=600, s-maxage=600`. A CDN then pins that SHA-less mock level for 10 minutes for every README viewer, even though a newer commit (or a real LLM scan keyed by the resolved SHA) exists.
- **Root cause**: The cache-control TTL is chosen by *outcome class* (resolved vs neutral) but doesn't account for *confidence*: a SHA-less fallback resolve is treated as fully "resolved" and gets the long shared TTL.
- **Impact**: Broken/stale badge advertising the wrong maturity level for up to 10 minutes after a push or after the first real scan, specifically during the windows when head resolution is failing.
- **Fix sketch**: When `sha == null` (no per-commit pinning), downgrade the response to `CACHE_NEUTRAL` (`max-age=30`) so a confident, SHA-pinned result can take over quickly.

## 4. `lastScanAt` can be null while `firstScanAt` is set → window reads "… → unknown"
- **Severity**: Low
- **Category**: empty-state / UX
- **File**: src/app/usage/page.tsx:226; src/lib/db/usage.ts:167-168
- **Scenario**: If `agg._max.scannedAt` is null but `_min` is not (shouldn't happen for a non-empty org, but Prisma `_min`/`_max` are independent aggregates and any null `scannedAt` row or driver edge can desync them), then the window line renders `${timeAgo(firstScanAt)} → ${timeAgo(usage.lastScanAt ?? undefined)}`, and `timeAgo(undefined)` returns the literal string `"unknown"`, producing "3mo ago → unknown".
- **Root cause**: The template assumes `lastScanAt` is non-null whenever `firstScanAt` is, but they're computed as two independent nullable aggregates.
- **Impact**: Confusing copy on the billing page ("unknown" end of window). Cosmetic, not a crash.
- **Fix sketch**: Fall back `lastScanAt ?? firstScanAt` for the window's right edge, or guard the whole branch on both being present.

## 5. Provider/visibility "By engine" + "Public vs private" panels divide by period total but show all-period bars — silent zero-bars when window is empty
- **Severity**: Low
- **Category**: divide-by-zero / period-boundary
- **File**: src/app/usage/page.tsx:183-201, 250
- **Scenario**: If an org has all-time scans (`totalScans > 0`, so the page renders) but **zero scans in the selected `days` window** (`periodScans === 0`) — e.g. `?days=1` after a quiet day — then every `Bar` gets `total=0`. `Bar` correctly guards `total > 0 ? … : 0`, so no `NaN`, but the page renders the full totals header and four populated `Stat` cards while every percentage bar reads "0 · 0%". The "By inference engine" panel separately shows "No scans in this period" (because `byProvider` is period-scoped) right next to non-zero all-time `Stat`s, which is internally inconsistent.
- **Root cause**: Totals (`totalScans`, `distinctRepos`) are all-time while the bars are period-scoped, and the empty-state short-circuit only checks `totalScans === 0`, not the empty-*period* case.
- **Impact**: A billing dashboard that looks half-broken (all-zero bars beside non-zero totals) for short or quiet windows. No crash; the `> 0` guard in `Bar` already prevents `NaN%`.
- **Fix sketch**: Add a "no scans in the last Nd" notice when `periodScans === 0`, or label the all-time `Stat`s clearly as all-time so the mixed scopes don't read as a bug.

## 6. `days` clamp diverges between page and API for non-numeric input, and `Math.min/Math.max` lets the URL force a 365-day full-table scan unauthenticated for `public`
- **Severity**: Medium
- **Category**: untrusted-input / unbounded-lookup
- **File**: src/app/api/usage/route.ts:37; src/lib/db/usage.ts:92, 213-231
- **Scenario**: If an anonymous caller hits `/api/usage?org=public&days=365` repeatedly, then `getUsageSummary` runs ~10 aggregates plus a `$queryRaw` grouping over a 365-day window with no auth and no rate limit (the IDOR guard only fires for non-`public` orgs). On a large shared `public` org this is an expensive, repeatable, unauthenticated query — a cheap DoS lever. `Number("abc") || 30` also silently coerces garbage to 30 rather than rejecting it, so probing is frictionless.
- **Root cause**: The `public` org is intentionally world-readable, but the per-request *cost* (window size × table size) wasn't bounded for the unauthenticated path — only access *identity* was gated.
- **Impact**: Unauthenticated, repeatable heavy DB load on the `public` usage path (resource exhaustion / cost). Not data leakage, since `public` is by-design public.
- **Fix sketch**: Add a small per-IP rate limit on the unauthenticated `public` branch (mirror the badge limiter), and/or cap `days` lower for anonymous callers; consider a short CDN cache on the `public` JSON response.

## 7. `clientIp` rate-limit bucketing collapses to a single shared "unknown" bucket on platforms that don't set `x-real-ip` — global throttle or trivial bypass
- **Severity**: High
- **Category**: silent-failure / rate-limit-bypass
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:45-60, 63-74
- **Scenario**: If the badge runs behind a proxy that sets neither `x-real-ip` nor `x-forwarded-for` (or strips them), then *every* caller maps to the single `"unknown"` bucket: `RATE_LIMIT = 60`/min shared across the entire internet, so one busy crawler exhausts the budget and every legitimate README viewer gets the 429 "rate limited" badge. Conversely, on a proxy chain where the right-most XFF hop is attacker-influenceable (e.g. a misconfigured front door that appends rather than overwrites), the limiter keys on a value the client can vary, minting fresh buckets and bypassing the limit entirely.
- **Root cause**: IP attribution is best-effort across heterogeneous proxy setups, but the fallback is a *single global* bucket rather than fail-open-per-request or a configured trusted-hop count — so a missing header silently converts a per-IP limiter into a global one.
- **Impact**: Either a self-inflicted DoS (all badges show "rate limited" cluster-wide once the shared 60/min trips) or an ineffective limiter (bypass), depending on the deployment's header behavior. The `scanRepository` call this guards is the expensive one, so getting it wrong matters.
- **Fix sketch**: Make the trusted-hop source explicit/configurable (e.g. `TRUSTED_PROXY_HOPS` to index into XFF) and document the required platform header; when no trustworthy IP exists, prefer failing *open per-request for the cheap path* while still capping the global `scanRepository` concurrency separately, rather than a shared 60/min that throttles the whole fleet.
