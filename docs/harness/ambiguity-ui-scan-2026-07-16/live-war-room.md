# Live War Room — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

Note: the manifest paths for this context are stale — the components live under `src/components/org/live/` and `src/components/org/shared/` (e.g. `liveWarRoomShared.ts` is in `shared/`, `LiveWarRoom.tsx` in `live/`). Worth a context-map refresh.

## 1. The headline "real-time leaderboard" is unreachable on the main wall and the shared kiosk — and PostureMix is dead code
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/components/org/live/LiveWarRoom.tsx:102` (non-TV branch), `src/components/org/live/LiveWarRoomPanels.tsx:6`, `src/components/org/live/LiveWarRoomTvStages.tsx:52`
- **Scenario**: The context is sold as "real-time leaderboard, celebrations, headline stats". But the default wall (`/org/[slug]/live`, non-TV branch) renders only header + timetable + attention strip + HeadlineStrip + ship-loop — `Leaderboard` and `MoversTicker` are mounted ONLY inside Dynamic TV stages (`TvStanding`/`TvScanning`), and Dynamic TV is gated `!readOnly && tvMode` (LiveWarRoom.tsx:74). So the shared kiosk (`/live/shared/[token]`) — whose share button promises "show this wall on an unauthenticated screen" — can NEVER show the leaderboard or the live movers. `PostureMix` has zero importers anywhere (grep-verified): fully dead. Meanwhile the header copy shown on the kiosk still says "the leaderboard reshuffles" (LiveWarRoomHeader.tsx:128-130).
- **Root cause**: The leaderboard/panels were migrated into TV stages at some point without recording the decision that the flat wall and the kiosk lose them; the carefully-built `readOnly` variants inside Leaderboard/MoversTicker/PostureMix ("N ranked" plain rows, session-gated links suppressed) are now unreachable dead branches because their only mount site is authenticated-TV-only.
- **Impact**: The kiosk — the surface most literally "projected during a review" — shows no leaderboard, no movers, no posture mix, while its own header text promises a reshuffling leaderboard. Dead code (PostureMix + all three readOnly branches) keeps being maintained and tested against a surface that can't exist.
- **Fix sketch**: Decide and record the intent: either (a) render `Leaderboard` (+ MoversTicker) on the flat wall and kiosk again — their readOnly props already exist for exactly this — or (b) delete `PostureMix` and the unreachable readOnly branches, and reword the header copy for the kiosk. If TV-only is intentional, let the kiosk enter a read-only stage rotation (the stage data needs nothing session-gated for `TvStanding` minus ship-loop).

## 2. Goal deadline countdown is computed against UTC midnight — "past deadline" fires up to a day early/late depending on viewer timezone
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/components/org/live/LiveWarRoomHeader.tsx:25`
- **Scenario**: `daysUntil` does `Date.parse("YYYY-MM-DD")`, which is UTC midnight at the *start* of the deadline day, then `Math.ceil((t - Date.now()) / 86_400_000)`. On the deadline day itself, a viewer west of UTC (e.g. US afternoon) sees "1d past deadline" on the projected wall while the date is still today locally; a viewer east of UTC sees "1d to deadline" all day. Whether the goal means "by start of" or "end of" the target date is nowhere decided.
- **Root cause**: The date-only string is implicitly promoted to a UTC instant and compared to a local wall clock; the semantic ("deadline inclusive?") was never recorded.
- **Impact**: A war-room wall announcing "1d past deadline" during the deadline-day review is exactly the wrong moment for an off-by-one — it publicly misstates the campaign's status.
- **Fix sketch**: Define the deadline as end-of-day local (or end-of-day UTC, documented): parse to `new Date(y, m-1, d + 1)` (local midnight after the deadline) before the diff, and add a comment stating the inclusivity decision. A unit test at the boundary (23:00 local on the deadline day, both hemispheres) pins it.

## 3. Screen wake-lock is fired-and-forgotten: never re-acquired after tab switch, never releasable on TV exit
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/components/org/live/LiveWarRoomHeader.tsx:11-22`
- **Scenario**: `enterTvMode()` requests `wakeLock.request("screen")` and discards the sentinel. Browsers auto-release the lock whenever the page is hidden (tab switch, OS overlay, projector input flip) — and nothing listens for `visibilitychange` to re-acquire it. Conversely, exiting TV mode (Esc) can't release the lock because the sentinel was thrown away, so the display stays forced-awake for the tab's lifetime.
- **Root cause**: The "best-effort; fails silently" comment covers the *acquisition* failing, but the dominant real-world failure — silent mid-session release on visibility loss — is an undocumented gap, and holding no sentinel makes release impossible.
- **Impact**: The primary use case (a wall projected for a long review, with the presenter alt-tabbing once) quietly loses its keep-awake guarantee and the screen sleeps mid-presentation; after exit, the opposite — battery/display burn on kiosk hardware.
- **Fix sketch**: Keep the sentinel in a ref; on `visibilitychange` → visible, re-request; on TV-mode exit / unmount, `sentinel.release()`. The kiosk view (which already tracks `visible` in `useLiveWarRoom`) is the natural owner.

## 4. "AI-Native repos" tile denominator silently changes meaning (`scored || total`)
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/components/org/live/LiveWarRoomStat.tsx:182-183`
- **Scenario**: The headline tile renders `${n}/${stats.scored || stats.total}`. With ≥1 scored repo the denominator is "repos scored"; with 0 scored it flips to "all repos in the fleet" — and precisely in that case the clarifying `sub` line ("of N scored") is suppressed (`stats.scored > 0` gate), so the unlabeled fallback denominator is the one shown *without* its label. `0/40` (fleet size) and `0/0-scored` read identically on a projected wall.
- **Root cause**: `||` used as an empty-state fallback conflates two different denominators; the choice isn't commented and the sub-label gate excludes exactly the ambiguous branch.
- **Impact**: On a fresh/kiosk wall before any scan, the biggest number on the strip quantifies something different from what it quantifies five seconds after the first result lands — an honesty problem for a stat explicitly "meant to be projected".
- **Fix sketch**: Always show the sub line and make it name the denominator ("of N scored" / "no scans yet"), or render `—` with a "no scans yet" sub when `scored === 0` instead of borrowing `total`.

## 5. TV-mode auto-rotation is pausable only by mouse hover; keyboard/remote control is undiscoverable
- **Severity**: Low
- **Category**: a11y
- **File**: `src/components/org/live/LiveWarRoomTv.tsx:78-99,116-118`
- **Scenario**: Stages rotate every `STAGE_MS = 14s`. The only pause mechanism is `onMouseEnter`/`onMouseLeave` on the container; Arrow-key prev/next exists but nothing on screen or in a title hints at it, and there is no keyboard/focus-based pause at all. The stage-indicator buttons are `text-xs` — in a component whose stated goal is "big enough for a wall across the room".
- **Root cause**: The hover-pause was designed for a presenter with a mouse; WCAG 2.2.2 (Pause, Stop, Hide) requires auto-advancing content to be pausable by any user, and the keyboard affordances were added without discoverability.
- **Impact**: A keyboard-only presenter (or a kiosk driven by a presenter remote emitting focus/keys) cannot hold a stage while discussing it — the wall flips mid-sentence every 14 s; the tiny stage tabs are illegible from the room.
- **Fix sketch**: Pause on `focusin`/`focusout` within the container (mirroring hover), add an explicit Pause/Play toggle in the header (also fixes 2.2.2), map Space to it, and bump the stage indicator to the header's `text-sm` mono scale with the keyboard hints in its title.
