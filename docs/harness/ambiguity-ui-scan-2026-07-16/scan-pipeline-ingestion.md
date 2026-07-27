# Scan Pipeline & Ingestion — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. "Email me when it's done" custom address is collected from signed-in users, then silently discarded by the server
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/components/ScanForm.tsx:131-144` (+ `src/components/scan/NotifyToggle.tsx:50,72-83`, `src/app/api/scan/stream/route.ts:90-94`)
- **Scenario**: A signed-in viewer whose GitHub account exposes no email (a common privacy setting) checks "Email me when it's done". NotifyToggle shows the custom-address field (`needsCustom = notifyOn && !viewerEmail`), ScanForm validates it, stashes it in `sessionStorage("ascent:notify-email")`, and ReportClient sends it as `body.email`. But the stream route's open-relay hardening resolves `notifyTo` for a signed-in viewer ONLY from `viewer.email` — `body.email` is honored solely on the anonymous funnel — so `notifyTo` is `undefined` and no mail is ever sent.
- **Root cause**: The server-side fix that removed the `viewer?.email ?? body.email` fallback (a real open-relay vector) was never propagated to the client: the UI still walks the user through the exact path the server now refuses. The stream route's comment even documents the new policy while the form keeps promising the old one.
- **Impact**: The user gets explicit confirmation ("Email me when it's done" checked, address validated, scan runs) and then silently receives nothing — a broken promise on the highest-friction moment the toggle exists to soften (multi-minute scans, "close the tab, we'll email you"). Worse than no feature: the user leaves *because* they trust the email.
- **Fix sketch**: Make client and server agree. Cheapest honest option: for signed-in viewers with no account email, replace the custom-address input with copy like "Your account has no public email — add one on GitHub to get notified" (and drop the sessionStorage plumbing). If the custom address should work, implement the follow-up the server comment already tracks (double-opt-in / verified alternate address) and only then re-enable the field.

## 2. Quota window documented three different ways: "weekly" / "3 free slots" in the routes vs the actual 5-per-rolling-30-days
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/app/api/scan/stream/route.ts:96,230,265` (+ `src/app/api/scan/route.ts:151,293-294`, actual: `src/lib/public-scan-quota.ts:46-63`)
- **Scenario**: Both scan routes describe the free allowance as a "Weekly SOFT gate", the response headers as "free public scans left in this IP's rolling weekly window", and the stream's refund comment says a failure "must not burn one of the anonymous tier's 3 free slots". The implementation is a rolling **30-day** window with a default of **5** (`PUBLIC_SCAN_MONTHLY_LIMIT`-style env, `WINDOW_MS = 30d`), and the landing FAQ (`src/app/page.tsx:56`) sells "5 scans a month free".
- **Root cause**: The quota was re-scoped (weekly→monthly, 3→5) in `public-scan-quota.ts` / `scan-finalize.ts`, but the six or so narrative comments in the two consuming routes — the places a maintainer actually reads when changing refund/ordering logic — were never updated.
- **Impact**: Anyone reasoning about refund policy, header semantics (`x-ascent-quota-reset`), or abuse economics from the route code gets the window wrong by 4x and the allowance wrong by 40%. It also invites future UI copy ("resets weekly") that contradicts both the FAQ and the enforced behavior.
- **Fix sketch**: Sweep the two routes for "weekly"/"3 free slots" and reword to "monthly (rolling 30-day) allowance, default 5 — see public-scan-quota.ts", or better, drop the numbers from the comments entirely and point at the single source of truth so the next re-scope can't drift.

## 3. Invalid notify-email error is announced and ARIA-wired as an error on the *repository* input
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/ScanForm.tsx:136-141` (+ `:186-189`, `:230-234`)
- **Scenario**: With notify checked and a bad custom email, submit sets the shared `error` state ("Enter a valid email to be notified…"). That state (a) shakes the whole repo form, (b) sets `aria-invalid` and `aria-describedby={errorId}` on the **repo** input, and (c) renders the message in the slot under the repo field — while the actual offending field, NotifyToggle's email input further down, gets no `aria-invalid`, no described-by, no border change, and no focus.
- **Root cause**: One `error` string serves two distinct fields; the ARIA plumbing (carefully added for the repo-validation case, per the `role="alert"` comment) was never forked when the email path started reusing it.
- **Impact**: A screen-reader user hears the repo field is invalid and an email complaint attached to it — the valid repo they typed appears broken, and the real fix location is unnamed. Sighted users get a shake on the wrong control and must visually hunt for the email box. Directly undercuts the a11y work the file already invests in.
- **Fix sketch**: Give the email input its own error state: `aria-invalid` + `aria-describedby` on the NotifyToggle input (pass an `error` prop), render the message adjacent to it, and move focus to the offending field on failed submit. Keep the repo-error slot for repo errors only.

## 4. Concurrent coalesced scans each burn a monthly free slot for one shared computation — the "meters on commit, not attempt" policy is timing-dependent
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/app/api/scan/route.ts:154` (+ `:219`, `src/app/api/scan/stream/route.ts:99,181-183`, `src/lib/cache.ts:193-237`)
- **Scenario**: Both routes consume a quota slot per request *before* joining `coalesceScan`. Two callers of the same uncached commit (documented as a normal case: StrictMode double-mount, peek-then-stream, two tabs) share one ingest+LLM run, but each keeps its consumed slot — dedup refunds the *credit* reservation (`if (deduped) await refundCredit()`) and cache hits refund the *quota*, yet a coalesce-join refunds neither. A user whose second tab lands 1s later pays 2 of 5 monthly slots; landing 1s after completion (cache hit) pays 1.
- **Root cause**: The refund policy ("the free tier meters on commit, not attempt — same policy as credit metering") is enforced for failure/degrade/cache paths but the coalesce path has no signal distinguishing "I computed" from "I joined", and no comment records whether double-charging joiners is intended or an accepted approximation.
- **Impact**: With an allowance as small as 5/month, one double-mount or peek-race can silently cost 40% of a user's monthly free tier for a single report — invisible in the UI (the quota headers even disagree between the two racing responses) and inconsistent with the stated metering policy the credits side honors via `deduped`.
- **Fix sketch**: Have `coalesceScan` (or its return) expose whether the caller was the computing owner vs a joiner, and refund the joiner's slot — mirroring the `deduped→refundCredit` rule. At minimum, record the decision in a comment next to the consume so the asymmetry reads as chosen, not overlooked.

## 5. GET /api/scan runs a full quota-consuming, credit-metering scan on a side-effectful GET
- **Severity**: Low
- **Category**: undocumented-assumption
- **File**: `src/app/api/scan/route.ts:348-368`
- **Scenario**: The GET handler without `peek=1` executes the identical expensive path as POST: consumes a monthly quota slot, can reserve a prepaid org credit (via auto-resolved installation), spends GitHub + LLM budget, and persists a report. GETs are the requests that prefetchers, link expanders, crawlers, and browser URL-bar autocompletion replay — and they carry the session cookie, so the prod auth gate does not stop a signed-in user's own browser from re-firing one.
- **Root cause**: The GET surface exists for convenience (`?mock=1` demos, peeks) and grew the full scan path with it; no comment records whether a real scan-on-GET is intended, and nothing distinguishes it from the safe peek mode (which got its own rate limit precisely because GETs get replayed).
- **Impact**: A bookmarked/autocompleted `GET /api/scan?url=...` can silently burn free-tier slots or org credits with no UI ever shown — the refund machinery only covers failed scans, not unwanted successful ones. Low likelihood today (nothing in-app links to it), but it is an unbounded-cost mutation on an idempotent verb.
- **Fix sketch**: Restrict GET to the cheap modes (`peek`, `mock`) and 405 or redirect real scans to POST; or document explicitly why scan-on-GET is required (badge/CI integration?) and add `Cache-Control: no-store` + a comment naming the accepted risk.
