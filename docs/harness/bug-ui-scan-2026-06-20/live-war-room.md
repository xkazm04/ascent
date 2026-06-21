> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# Live War Room — combined bug+ui scan

## 1. Shared/TV war-room is a frozen snapshot, not "live"
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: stale-data / live-refresh
- **File**: src/app/live/shared/[token]/page.tsx:45 (and src/components/org/LiveWarRoom.tsx:248)
- **Scenario**: An owner mints a TV share link and projects `/live/shared/[token]` on an unauthenticated wall during a review. Meanwhile authenticated users re-scan the fleet. The shared wall never changes.
- **Root cause**: The shared view renders `LiveWarRoom` with `readOnly`, which (a) hides the Launch control AND never opens the `/api/org/scan` SSE stream, and (b) has no polling/`getOrgRollup` refresh. The only live data path in `LiveWarRoom` is the SSE stream started by `launch()`, which `readOnly` suppresses. So the entire purpose — a *live*, presentation-mode wall meant to be left running — is a one-time server snapshot taken at page load. `force-dynamic` only re-renders on navigation, not over time.
- **Impact**: The flagship "live war room" feature is static on exactly the surface it was built for (kiosk/TV). Stats, leaderboard, posture mix and celebrations are stale for the entire session.
- **Fix sketch**: In `readOnly` mode, subscribe to a read-only live source (e.g. an SSE/poll endpoint that re-reads the org rollup on an interval and re-seeds `repos`), or add a periodic `router.refresh()`/`setInterval` re-fetch of the rollup so the kiosk view actually updates. At minimum, surface a "snapshot as of <time>" caption so viewers aren't misled by the "Live" framing.

## 2. Auto-relaunch keeps spending fleet scan credits on a backgrounded/idle wall
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: resource/credit waste / lifecycle
- **File**: src/components/org/LiveWarRoom.tsx:248-252
- **Scenario**: A user enables "Auto-relaunch every 15 min" for a wall display, then closes the laptop lid / switches tabs / walks away. Every 15 minutes the page fires a full POST `/api/org/scan` across every watched repo, each scan consuming prepaid credits, indefinitely.
- **Root cause**: The auto-loop effect re-arms a 15-minute `setTimeout` whenever `autoLoop && !running`, with no `document.visibilityState`/`hidden` guard and no idle/attention check. There is also no cap on consecutive unattended runs. The toggle is persisted to `localStorage`, so a single forgotten check stays armed across reloads forever.
- **Impact**: Silent, unbounded credit burn on a feature explicitly designed to be left unattended; can drain an org's scan budget overnight with no one watching.
- **Fix sketch**: Skip/defer the scheduled launch while `document.hidden` (and resume on `visibilitychange`); optionally pause auto-loop after N consecutive unattended cycles, or require a recent user interaction. Show the next-relaunch time so the cost is visible.

## 3. Deadline countdown is off by a day for non-UTC viewers
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: date/timezone
- **File**: src/components/org/LiveWarRoomHeader.tsx:25-30
- **Scenario**: A goal has `targetDate` "2026-07-01". A viewer in UTC-7 opens the wall on 2026-06-30 late evening local time. The header shows "1d to deadline" when it should show "1d", or flips to "past deadline" a day early near the boundary.
- **Root cause**: `daysUntil` does `Date.parse("YYYY-MM-DD")`, which JS parses as **UTC midnight**, then subtracts `Date.now()` (a local instant) and `Math.ceil`s the day delta. For viewers west of UTC the UTC-midnight anchor is in their "future", shifting the ceil by a day around the boundary. (The team already flagged "daysUntil (canonical org tz)" as an open decision.)
- **Impact**: Misleading deadline/"Nd past deadline" countdown on a leadership-facing projected wall; can show a goal as overdue a day early or on-time a day late.
- **Fix sketch**: Parse the date as a local calendar date (split `Y-M-D` and build `new Date(y, m-1, d)`), or compute the diff in a fixed canonical org timezone, comparing date-only floors rather than instants.

## 4. Live headline tiles update with no accessible live region
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y / live regions
- **File**: src/components/org/LiveWarRoom.tsx:328-350 (AnimatedStat at src/components/org/LiveWarRoomStat.tsx:49)
- **Scenario**: A screen-reader user (or anyone relying on assistive tech for a presentation) watches the wall during a scan. Org maturity / AI adoption / rigor / AI-Native tiles count up as results land, but nothing is announced.
- **Root cause**: The four headline `AnimatedStat` tiles — the dashboard's primary numbers — have no `aria-live`/`role="status"`. Only the small "scanning …/… repos" caption and the celebration toasts carry `aria-live="polite"`. The most important values change silently. (Tweening per-frame means a naive `aria-live` on the digits would be far too chatty, so this needs a debounced summary, not a blanket live region.)
- **Impact**: The headline state of a "live" dashboard is inaccessible; a screen-reader user gets no signal that the fleet numbers moved.
- **Fix sketch**: Add a single visually-hidden `aria-live="polite"` summary region that announces the settled tile values once per scan completion (or on a debounce), rather than annotating the per-frame tweened digits.

## 5. Run progress bar can render past 100% when the run is truncated for credits
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: progress/state mismatch
- **File**: src/components/org/LiveWarRoom.tsx:190-200, 293, and src/components/org/LiveWarRoomHeader.tsx:223
- **Scenario**: A credit-limited fleet scan emits a `notice` that shrinks `total` to the `scanning` slice (e.g. 5), but subsequent `progress` events still carry the server's original `total`/`index` over the full watch list — or `done` momentarily exceeds the shrunken `total`. `pct = round(done/total*100)` then exceeds 100.
- **Root cause**: `notice` overwrites `progress.total` with `scanning`, but each `progress` event unconditionally resets `total` to `Number(data.total)` and `done` to `Number(data.index)`; the two denominators aren't reconciled. The bar width is `Math.max(3, pct)%` with **no upper clamp**, and `${progress.done}/${progress.total} repos` can read e.g. "7/5".
- **Impact**: Visibly wrong progress (bar overshoot, "7/5 repos") on a projected wall; undermines confidence in the live numbers.
- **Fix sketch**: Clamp `pct` to `[0,100]` (and bar width to `min(100, max(3,pct))`), and clamp `done` to `total` for the caption; or have `progress` events respect the credit-truncated denominator.

## 6. TV/shared view shows a "Sound" toggle that can never make a sound
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: consistency / dead control
- **File**: src/components/org/LiveWarRoom.tsx:321-322 (toggle rendered in src/components/org/LiveWarRoomHeader.tsx:169-174)
- **Scenario**: A viewer on the read-only `/live/shared/[token]` wall sees and can toggle the "Sound" celebration checkbox, but no scan ever runs in `readOnly`, so a celebration chime can never fire.
- **Root cause**: `onToggleSound`/`sound` are always passed to `WarRoomHeader`, and the header gates the Sound checkbox only on `onToggleSound` being present — not on `!readOnly` (unlike the Launch/Stop/Auto-relaunch controls, which are correctly `!readOnly`-gated). Celebrations only originate from the SSE fold, which `readOnly` never starts.
- **Impact**: A non-functional control on the kiosk view; minor confusion / inconsistency with the other readOnly-suppressed controls.
- **Fix sketch**: Gate the Sound toggle on `!readOnly` (or hide all scan-driven controls together), matching the Auto-relaunch toggle's treatment.
