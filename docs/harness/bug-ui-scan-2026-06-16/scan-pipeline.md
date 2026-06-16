# Scan Pipeline & Ingestion — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 3, Medium: 2, Low: 0)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 12

## 1. Coalesced waiters double-refund a single consumed quota slot
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race condition / quota accounting
- **File**: src/app/api/scan/stream/route.ts:163 (also src/app/api/scan/route.ts:159)
- **Scenario**: Two anonymous clients (or the /report peek-miss + a StrictMode double-mount + a second tab) hit the same uncached commit within the same instant. Each request independently runs the quota block (`consumePublicScanQuota`) and records its own hit, then both join `coalesceScan(lookup.cacheKey, …)` onto ONE shared scan run. That run degrades to mock (transient LLM 429), so each request sees `degradedToMock === true` and calls `refundQuota()`.
- **Root cause**: The consume/refund pairing is correct per-request, but the *single* underlying scan's outcome (degrade-to-mock, low-coverage, in-stream cache hit) fans out to N coalesced callers, each of whom charged a slot and each of whom now refunds one. That part nets out. The real exposure: when callers bucket to the *same* IP/user (the common StrictMode/two-tab case → identical `ipHash`), the two refunds run as two serialized read-modify-write transactions that each call `removeNewestHit`, so a *single* genuinely-consumed slot can be refunded twice — the second refund drops an unrelated earlier hit, under-counting the window and silently granting an extra free scan. `removeNewestHit` has no idempotency key tying a refund to the specific hit it consumed.
- **Impact**: Quota under-counting on the shared free tier; a scripted double-submit can grind the weekly cap. Soft gate, so not catastrophic, but it defeats the cost nudge precisely under the concurrency the coalescing was built for.
- **Fix sketch**: Tie the refund to the exact timestamp the consume recorded (return `now` from `consumePublicScanQuota`, refund by value-match not "newest"), or make refund a no-op when this request never actually charged (it already guards on `quotaCharged`, but two requests to the same bucket each hold their own `quotaCharged`). Simplest: have refund remove the hit whose timestamp equals the consumed one, and tolerate "already absent" as success.

## 2. `parseSSE` concatenates multi-line `data:` payloads without newlines, corrupting JSON
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: streaming / parsing edge case
- **File**: src/lib/sse.ts:18
- **Scenario**: A `result` frame whose JSON the server emits across multiple `data:` lines (the SSE spec allows, and many producers/proxies re-wrap, a single logical payload into several `data:` lines that the consumer must rejoin with `\n`). `readSSE`/`parseSSE` does `dataStr += line.slice(5).trim()` — it both *trims* each line (eating significant leading/trailing whitespace inside string values) and joins with no separator, so `{"a":1}` split as `data: {"a":1` + `data: }` becomes `{"a":1}` only by luck, while `data: "foo ` + `data:  bar"` collapses to `"foo bar"` → wrong value, or invalid JSON → `data: null` swallowed silently.
- **Root cause**: Per the SSE spec, multiple `data:` lines in one frame must be joined with `\n` and only the single leading space after the colon stripped — not `.trim()` per line with empty-string join.
- **Impact**: For the org bulk-scan / war-room consumers that use this shared helper, a large or proxy-rechunked result frame can be silently dropped (`data: null` → message skipped) — a scan that completed server-side renders as "nothing arrived." ReportClient dodges this only because it ships its own parser; the shared primitive is the latent trap.
- **Fix sketch**: Accumulate `data:` lines into an array, strip only one optional leading space (`line.startsWith("data: ") ? line.slice(6) : line.slice(5)`), join with `"\n"`, then `JSON.parse` the whole.

## 3. `submitting` never resets — disabled form on bfcache/back-navigation and same-repo re-submit
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing state reset / stuck UI
- **File**: src/components/ScanForm.tsx:70 (and chip handler :160)
- **Scenario**: User submits, `setSubmitting(true)` + `router.push("/report?…")`. They hit Back. The landing page is restored from the browser bfcache *as-is* (no remount), so the form returns with the Scan button still spinning "Scanning…" and every chip disabled — permanently, until a hard reload. Same trap if `router.push` resolves to the current URL (re-clicking the identical chip while already navigating): no unmount, no reset.
- **Root cause**: `submitting` is set true on submit and relies entirely on the component unmounting during navigation to clear it; there is no `pageshow`/restore handler and no reset on navigation completion or error.
- **Impact**: A dead, fully-disabled hero form after a routine Back gesture — the primary CTA of the product. No way to recover without reload.
- **Fix sketch**: Reset `submitting`/`pendingChip` on `window.pageshow` (when `event.persisted`), or clear it in a `useEffect` cleanup / on `visibilitychange`. Also guard the chip handler against re-firing while `submitting`.

## 4. Stream `result`/`error` framing has no flush guarantee against proxy buffering after heartbeat removal
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: SSE lifecycle / silent failure
- **File**: src/app/api/scan/stream/route.ts:198
- **Scenario**: On the terminal path the code clears the heartbeat *before* `send("result", report)` (lines 198–200), then `finally` immediately `controller.close()`. If an intermediary (Vercel edge buffer, nginx) is still holding the response and the only thing that was reliably flushing it was the 15s `: ping`, the final `result` frame + close can land in one buffered chunk that the proxy may coalesce or, on a borderline-idle close, drop before forwarding — the client loop hits `done` with `!settled` and shows "The scan ended unexpectedly." despite a fully-computed report.
- **Root cause**: Heartbeat is the de-facto flush keepalive, and it's torn down one statement before the most important frame; there's no explicit terminal flush/`x-no-transform` is set but buffering at the platform layer isn't fully defeated for the very last write.
- **Impact**: Intermittent "ended unexpectedly" false-negative on otherwise-successful long scans — the worst failure mode because the work (LLM spend) was done and the user still sees an error.
- **Fix sketch**: Keep the heartbeat alive until *after* `send("result", …)` returns (or send the result, then a final `\n` flush, then clear+close), and confirm the comment's claim that an interleaved ping is harmful — the client already ignores comment frames, so the early-clear optimization trades a real flush guarantee for a non-problem.

## 5. No empty/zero-state for the gallery rail or leaderboard; rail has no keyboard scroll affordance
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing state / a11y
- **File**: src/components/landing/ScanGallery.tsx:98
- **Scenario**: `ScanGallery` is only rendered when `gallery` is truthy (page.tsx:187), but `gallery` can exist with an *empty* `recent` array (persistence on, scans purged/filtered). The rail then renders an empty `flex` row — a "Recently scanned" heading and intro paragraph over blank space, with `totalRepos` possibly reading "0 public repos scored". Separately, the horizontally-scrolling rail (`overflow-x-auto`) has no keyboard-focusable scroll mechanism and the cards beyond the viewport are reachable only by mouse/trackpad drag.
- **Root cause**: The render guard is on the gallery object, not on `recent.length`; there's no empty branch. The rail relies purely on pointer scroll.
- **Impact**: A hollow, broken-looking discovery section on a fresh/low-data deploy — the section meant to build trust does the opposite. Keyboard users can't reach off-screen rail cards.
- **Fix sketch**: Gate the rail on `recent.length > 0` (and suppress the whole section when both `recent` and `topAiNative` are empty), or render a one-line empty state ("Be the first — scan a repo above"). Add `tabIndex`/`aria-label` to the scroll container or visible scroll buttons so the rail is keyboard-operable.
