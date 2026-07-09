# Quotas & Rate Limiting — bug-hunter + ui-perfectionist scan

> Context: Quotas & Rate Limiting (group: Billing, Credits & Metering)
> Files scanned: 7
> Total: 7 findings (Critical: 0, High: 0, Medium: 2, Low: 5)

## 1. Quota-exceeded message hardcodes "5 free scans" — wrong under any override or signed-in tier
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: incorrect-messaging
- **File**: src/lib/public-scan-quota.ts:392
- **Scenario**: An operator sets `PUBLIC_SCAN_MONTHLY_LIMIT=10` (or a signed-in viewer runs on the elevated `PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN` tier). On exhaustion, `monthlyQuotaExceeded` returns the 429 body whose `error` string reads "You've used your **5** free scans this month." — the exact copy the report page's `QuotaBlocked` renders (via scan-finalize.ts:61).
- **Root cause**: The message is a static literal that assumes the limit is always the default 5, while the limit is env-configurable per scope and passed nowhere near the string.
- **Impact**: User-facing lie about how many scans they get; erodes trust in the upgrade prompt and makes support tickets. Silent whenever the deployment isn't on default 5/5.
- **Fix sketch**: Thread the actual limit into `monthlyQuotaExceeded(result, limit)` (or add `limit` to `QuotaResult`) and interpolate it: ```You've used your ${limit} free scans this month.```.

## 2. Global rate-limit ceiling self-perpetuates — a 1s spike becomes a sustained lockout
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/lib/rate-limit.ts:83
- **Scenario**: `hit()` (line 34) pushes `now` into the window BEFORE the cap check. `rateLimitRequest` charges the global window whenever per-IP passes (line 83). Suppose a 1s burst fills the global window (default 120/60s). Every subsequent under-per-IP request from any IP is rejected — but is still recorded, pushing `recent[0]` forward. As long as legit traffic ≥ limit/window (~2 req/s) continues, the window never drains below `global`, so the funnel stays 429'd for the full window even though zero real LLM work happens after the initial spike.
- **Root cause**: The global "spend ceiling" is assumed to measure real spend, but it counts rejected (zero-cost) attempts too. The QUOTA-#1 fix stopped per-IP-rejected floods from charging global, but a global-rejected request still charges global.
- **Impact**: A brief spike escalates into a prolonged instance-wide public-funnel outage under otherwise-normal load; legit users locked out far longer than the actual overload lasted.
- **Fix sketch**: Split record-vs-check for the global window: peek `recent.length` first, reject without pushing when already ≥ `global`, and only append when the request is admitted (mirror the per-IP short-circuit intent).

## 3. QuotaMeter out-of-order fetches can clobber a fresh count with a stale one
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/QuotaMeter.tsx:24
- **Scenario**: `load()` fires on mount plus `focus`, `visibilitychange`, and `pageshow`. Rapid tab-switching launches overlapping `fetch("/api/quota")` calls; if an earlier (slower) response resolves after a later (faster) one, the older payload wins and `setQ` shows a stale `remaining`. The `active` flag only guards unmount, not response ordering.
- **Root cause**: No request-sequencing/cancellation — assumes responses resolve in issue order.
- **Impact**: Meter briefly shows the wrong "scans left" (e.g. more than the visitor actually has) right after a scan. Minor, self-correcting on next focus.
- **Fix sketch**: Track a monotonically increasing request id (or an `AbortController`) and ignore/abort all but the latest in-flight `load()`.

## 4. `removeNewestHit` is dead in production (refund is value-keyed only)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: dead-code
- **File**: src/lib/public-scan-quota.ts:311
- **Scenario**: `refundPublicScanQuota` now removes the exact charged slot via `removeHit` (line 371); `removeNewestHit` has no runtime caller (only the test file references it), yet its docstring still describes it as "the one `consumePublicScanQuota` just appended", implying it's the live refund mechanism.
- **Root cause**: The critical double-refund fix superseded the newest-hit strategy but left the old helper exported and mis-documented.
- **Impact**: Maintenance hazard — a future dev could wire the racy `removeNewestHit` back into a refund path, reintroducing the double-refund/free-scan-bypass class the value-keyed fix closed.
- **Fix sketch**: Delete `removeNewestHit` and its tests, or add an explicit `@deprecated` note that it must not be used for refunds.

## 5. Pervasive "7-day / weekly" comments contradict the 30-day `WINDOW_MS`
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: stale-docs
- **File**: src/lib/public-scan-quota.ts:136
- **Scenario**: `WINDOW_MS` is 30 days (line 46) and the public API is "5 scans/month", but inline comments still say "7-day persistent quota" / "ONE weekly bucket" / "locked out for a week" / "Trims hits older than 7 days" / "age past the week" (lines 108-109, 136, 158, 162, 214, 289 and the `QuotaDecision`/`chargedAt` docstrings).
- **Root cause**: The window was widened from 7 to 30 days but the surrounding prose wasn't updated.
- **Impact**: A maintainer trusting the comments could "fix" the wrong constant or mis-tune `retryAfterSec`, or mis-explain behavior to users. No runtime effect today.
- **Fix sketch**: Sweep the file replacing week/7-day language with the 30-day/monthly window; the math already keys off `WINDOW_MS`.

## 6. QuotaMeter uses raw `amber-300/slate-*` colors instead of the shared `warn`/token palette
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: design-system-adherence
- **File**: src/components/QuotaMeter.tsx:61
- **Scenario**: The meter renders its low-allowance warning with hardcoded `text-amber-300` and its normal state with `text-slate-500`, while the report-side quota surfaces (QuotaNotice.tsx) express the identical "warning vs quiet info" concept through the semantic `warn` token and shared `SHELL_TONES`. The two quota surfaces therefore signal the same state with different color systems.
- **Root cause**: Ad-hoc Tailwind color literals instead of the design-system tokens used elsewhere in the context.
- **Impact**: Visual inconsistency across the two places the quota is shown; a theme/token change to "warn" won't propagate to the meter.
- **Fix sketch**: Swap `text-amber-300` → `text-warn` and align the muted color with the token QuotaNotice uses (`text-slate-400`/divider), or share a tone helper.

## 7. QuotaMeter's "upgrade for more scans" is dead text, not a CTA
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: cta-affordance
- **File**: src/components/QuotaMeter.tsx:63
- **Scenario**: For an anonymous visitor the meter appends "· upgrade for more scans" as plain `text-slate-400` inline text with no link or action, whereas the report banners (QuotaNotice.tsx) render a real "Sign in for more" button or "See plans →" link for the same intent. The visitor reads an upgrade prompt they cannot act on at the exact pre-scan moment they're deciding.
- **Root cause**: The upsell copy was added as static text rather than an interactive element linking to `/pricing` (or the sign-in flow).
- **Impact**: Missed conversion and mild UX confusion — an upsell that looks like it should be clickable but isn't.
- **Fix sketch**: Wrap the phrase in an `<a href="/pricing">` (matching the report banner's `text-accent hover:text-white` link style), or drop it if the meter is intentionally non-actionable.
