# Quotas & Rate Limiting — Bug + UI Scan
> Context: Quotas & Rate Limiting (Billing, Credits & Metering)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

This context is unusually well-hardened — prior QUOTA-# waves already closed the per-IP/global global-budget DoS, the value-keyed double-refund race, the DSQL-vs-Postgres isolation branch, fail-open semantics, and salted-hash PII. No critical/high remains. The findings below are real but lower-severity reliability/UX gaps.

## 1. Absent proxy headers collapse every anonymous visitor into ONE weekly bucket (free-funnel lockout)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/rate-limit.ts:17-26 (clientIp → "unknown") consumed by src/lib/public-scan-quota.ts:94 (`hashIp(clientIp(req))`)
- **Value**: impact 7 · effort 3 · risk 3
- **Scenario**: On a deployment where neither `x-real-ip` nor `x-forwarded-for` reaches the app (self-host, mis-configured proxy, direct origin hits, internal LB that strips XFF), `clientIp` returns the literal `"unknown"`. The weekly quota then hashes *every* anonymous caller to `hashIp("unknown")` — a single shared bucket. After the first 3 anonymous public scans across the entire site, every anonymous visitor is 429'd for up to 7 days.
- **Root cause**: The `"unknown"` collective fallback is a deliberate, correct fail-CLOSED choice for the per-minute burst limiter (one shared bucket = bounded blast radius). But the same key flows unchanged into the 7-day persistent quota, where "collective limit" means "global lockout for a week," the opposite of the module's stated fail-OPEN-on-uncertainty intent.
- **Impact**: The free/public funnel — the product's top-of-funnel — silently dies for all new anonymous users until the window rolls; looks like an outage, not a quota.
- **Fix sketch**: In `bucketContext`, when `clientIp(req) === "unknown"`, treat the weekly gate as unenforceable for that request (return `enforced:false`/allow, like the DB-unconfigured path) instead of bucketing on a shared sentinel. Keep the per-minute limiter's collective "unknown" behavior as-is; only the long-horizon gate needs the carve-out.

## 2. QuotaMeter never revalidates — shows a stale "scans left" count after a scan
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: loading-state
- **File**: src/components/QuotaMeter.tsx:22-33 (one-shot `useEffect([])` fetch)
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: The meter is rendered inside the landing ScanModal (src/components/landing/prototypes/index/ScanModal.tsx:137). A visitor opens the modal (meter fetches "3 of 3 left"), runs a scan (consuming a slot), then opens the modal again or runs a second scan — the meter still reads "3 of 3" because it only fetches once on mount and there is no re-fetch on scan completion, focus, or modal re-open. The number a user relies on to decide whether to scan is wrong.
- **Root cause**: `useEffect(..., [])` with no revalidation trigger and no shared store; the meter has no awareness of the scan lifecycle that mutates the value it displays.
- **Impact**: Misleads the user about remaining allowance — they think they have scans they don't, then hit an unexpected 429 block; erodes trust in the meter.
- **Fix sketch**: Re-fetch on a signal — e.g. accept a `key`/`refreshToken` prop the modal bumps after a scan resolves, or re-fetch on window `focus`/modal-open. Lightweight: expose the latest `x-ascent-quota-remaining` from the scan response into the same state the meter reads.

## 3. Refund's racy `removeNewestHit` fallback is still reachable via optional `chargedAt`
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/lib/public-scan-quota.ts:325-329, 344 (`typeof chargedAt === "number" ? removeHit : removeNewestHit`)
- **Value**: impact 5 · effort 3 · risk 4
- **Scenario**: The module's own docs (lines 319-323) flag the `removeNewestHit` path as the CRITICAL double-refund bug: two concurrent refunds on a shared/coalesced scan each peel a different sibling's still-live slot, under-counting the bucket and bypassing the weekly budget. The value-keyed `removeHit(prior, chargedAt)` fixes it — but `chargedAt` is an *optional* parameter, so any caller that forgets to thread it silently falls back into the documented critical race. Today only `scan-finalize.ts:72` calls refund, and it does thread `chargedAt`, so the bug is dormant — but the API shape invites its reintroduction.
- **Root cause**: The dangerous legacy path was kept as a fallback rather than removed; the type system doesn't force a caller to supply the slot identity that makes refunds safe.
- **Impact**: Latent money/abuse landmine — a future second caller (or a refactor that drops the arg) re-opens the free-scan bypass with no compile-time signal.
- **Fix sketch**: Make `chargedAt: number` required (drop `removeNewestHit` and the `| null` fallback), or have refund no-op when `chargedAt` is absent. Make the unsafe class impossible rather than reachable-by-omission.

## 4. Rate-limit `retryAfterSec` always reports the full window, over-stating the wait
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/rate-limit.ts:42 (`retryAfterSec: ok ? 0 : Math.ceil(windowMs / 1000)`)
- **Value**: impact 3 · effort 4 · risk 2
- **Scenario**: The limiter is a *sliding* window, but on a trip it always returns `windowMs/1000` (60s) as `Retry-After`, regardless of how soon the oldest in-window hit actually ages out. A caller whose oldest hit expires in 2s is told to wait 60s. README badge crawlers and well-behaved clients that honor `Retry-After` back off ~30× longer than necessary, depressing legitimate throughput right after a brief burst.
- **Root cause**: Fixed retry hint computed from the config, not from `recent[0]` — unlike the weekly quota, which derives a precise `resetAt` from the oldest hit.
- **Impact**: Unnecessarily long client back-off; mostly a UX/throughput nuisance, no correctness loss.
- **Fix sketch**: When over cap, compute `retryAfterSec = max(1, ceil((recent[0] + windowMs - now)/1000))` so the hint tracks the true sliding edge (mirror `public-scan-quota.retryAfterSec`).

## 5. QuotaBanner and QuotaStaleNotice are duplicated banner shells
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: component-extraction
- **File**: src/components/report/QuotaNotice.tsx:74-111 (QuotaStaleNotice) vs 119-158 (QuotaBanner)
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: Both render the identical structure — `role="status"`, the `◷` aria-hidden glyph, `mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg ... px-3 py-2 text-sm`, a flex-1 message, and the same `canOfferSignIn ? <SupabaseSignInButton variant="nav"> : <a href="/pricing">` CTA tail. They differ only in border/bg tint (warn vs divider) and copy. A change to the CTA or layout must be made in two places or they drift.
- **Root cause**: Copy-paste of the banner chrome instead of a shared `<QuotaBannerShell tone="warn"|"muted">` wrapper that takes the message + CTA as children.
- **Impact**: Maintenance drift risk and visual inconsistency over time; no user-facing defect today.
- **Fix sketch**: Extract a `QuotaBannerShell({ tone, children, cta })` primitive; render the shared `◷` + CTA logic once; have both notices supply only message/tone. Keeps the two distinct tones while collapsing the duplicated structure.
