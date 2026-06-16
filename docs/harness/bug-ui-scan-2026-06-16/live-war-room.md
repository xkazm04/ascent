# Live War Room — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 9

## 1. Headline tiles and leaderboard don't scale up for a projected wall
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: large-screen readability / projection
- **File**: src/components/org/LiveWarRoomStat.tsx:53 (and src/components/org/LiveWarRoom.tsx:338, 368)
- **Scenario**: This is the headline use case — the wall is projected on a TV/4K screen during an org review, read from across a room. A presenter clicks "⛶ TV mode" (fullscreen) on a large display.
- **Root cause**: The four hero numbers top out at `sm:text-4xl` (~36px) — there is no `lg:`/`xl:`/`2xl:` step. The leaderboard repo names are `text-base` and rank/score cells `text-sm`. The outer war-room container (`LiveWarRoom.tsx:338`) has no `max-w` cap *or* upscaling, so on a 1440px+/4K projector everything renders at desktop-laptop sizes surrounded by dead space. The *one* thing that should be huge — the org-maturity number meant to be seen from the back of a room — is laptop-sized.
- **Impact**: The core "project this during a review" promise underdelivers: numbers are unreadable from a distance, the wall looks like a browser window blown up rather than a purpose-built ops display. TV mode amplifies the gap (fullscreen, no larger type).
- **Fix sketch**: Add a breakpoint step to the hero numbers (`sm:text-4xl lg:text-5xl 2xl:text-7xl`) and the tile labels, and bump leaderboard name/score type at `xl:`. Optionally key a "wall density" off `requestFullscreen` state (the header already enters fullscreen) so TV mode scales typography up a notch.

## 2. Celebration fires only on *crossing* into AI-Native — silent on a re-run / loop where the seed already shows AI-Native
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: celebration trigger logic / milestone detection
- **File**: src/components/org/LiveWarRoom.tsx:175
- **Scenario**: Auto-relaunch (WAR-3) is on for an unattended wall, or the presenter clicks "↻ Re-run live scan". A repo that was already AI-Native at seed time is re-scored AI-Native again.
- **Root cause**: The trigger is `posture === "ai-native" && prev?.posture !== "ai-native"`. `launch()` (LiveWarRoom.tsx:182) resets `ticker` and `celebrations` but deliberately keeps `repos` (so the board doesn't blank). `prev` therefore still carries the prior AI-Native posture, so no celebration re-fires. This is *correct* for "no new crossing" — but it also means the **very first run after a page load never celebrates repos that were already AI-Native in the server seed** (seed posture is loaded into `repos` at mount, LiveWarRoom.tsx:49-51), and an auto-loop wall that someone walks up to mid-campaign shows zero celebrations even though the fleet is full of AI-Native repos. The milestone is defined purely as a *delta vs already-known state*, with no "first reveal" path.
- **Impact**: In the most common presentation scenario — open the wall, hit launch, fleet is already partly AI-Native — the celebratory bursts (the wall's signature moment) stay empty unless a repo happens to flip *during this exact run*. The feature reads as broken/never-fires to a presenter.
- **Fix sketch**: Distinguish "seeded" from "live" prior state. Track whether a repo has been scored *in this session* (e.g. `updatedAt === 0` means seed-only); on the first live score that lands AI-Native, optionally fire a softer "AI-Native" acknowledgement even when the seed already showed it, or gate first-run celebrations on `prev.updatedAt === 0`. At minimum, document that already-AI-Native repos are intentionally silent so it isn't mistaken for a bug.

## 3. Movers ticker + celebrations spam screen readers via `aria-live="polite"` on a large fleet
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility / live regions
- **File**: src/components/org/LiveWarRoomPanels.tsx:50 (and src/components/org/LiveWarRoomCelebrations.tsx:6)
- **Scenario**: A screen-reader user (or one is present in the review room) loads the wall and launches a scan of a 30–50 repo fleet. Results stream in over a minute or two.
- **Root cause**: The whole `<ul>` movers list is wrapped in `aria-live="polite"` (Panels.tsx:50), so every one of the up-to-14 streamed entries — plus reshuffles as the slice changes — is announced. The celebration stack (Celebrations.tsx:6) is *also* `aria-live="polite"` and announces every burst. With many repos landing back-to-back the announcements queue and lag far behind the visual state, and the redundant emoji/score markup gets read out.
- **Impact**: For an assistive-tech user this is a flood of low-value announcements (repo name + score, fourteen times, then celebration cards) that drowns out the genuinely important headline changes. It's the opposite of "polite."
- **Fix sketch**: Drop `aria-live` from the full ticker list; instead announce only summary milestones (e.g. a single visually-hidden live region that says "Scan complete: avg maturity N, M repos AI-Native"). Keep `aria-live` on celebrations but throttle/aggregate (announce "3 repos crossed into AI-Native" rather than three separate cards), and mark the per-card decorative score as `aria-hidden`.

## 4. Posture-distribution bars are scaled to the *max bucket*, not the fleet total — misreads as a true distribution on the wall
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: visual hierarchy / data honesty
- **File**: src/components/org/LiveWarRoomPanels.tsx:6, 22
- **Scenario**: A reviewer reads the "Posture distribution" panel projected on the wall to gauge what fraction of the fleet is AI-Native vs early/manual/ungoverned.
- **Root cause**: `max = Math.max(1, ...counts)` (Panels.tsx:6) and each bar width is `(n / max) * 100%` (line 22). So the *largest* bucket always renders as a full-width bar regardless of its share. If 2 of 40 repos are AI-Native and that's the biggest single quadrant, AI-Native shows as a 100% bar — visually "the whole fleet is AI-Native" — when it's 5%. The footer "{scored} repos scored" is the only honest signal and it's small mono text.
- **Impact**: On a projection wall, where the bar lengths *are* the message, this systematically overstates the leading posture and understates the rest. For a "maturity scanning" product whose credibility rests on honest scoring, a misleading distribution chart shown to leadership is a real reputational/decision risk.
- **Fix sketch**: Scale bar widths to the scored total (`n / scored`) so lengths represent actual share, and label each with its percentage or `n/scored`. If a max-relative view is wanted for emphasis, make that explicit ("relative") rather than implying proportions.

## 5. Audio-context closer timers accumulate in `timersRef` during a long auto-loop wall session
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: memory leak / cleanup
- **File**: src/components/org/LiveWarRoom.tsx:113-114
- **Scenario**: An unattended wall runs with Auto-relaunch + Sound enabled for hours; many repos cross into AI-Native over many loop iterations, each playing a chime.
- **Root cause**: Each `playChime()` schedules a `closer` timeout to close the `AudioContext` and does `timersRef.current.add(closer)` (line 113-114), but the closer callback never removes itself from the Set (contrast the celebration timer at line 124-126, which self-deletes via `timersRef.current.delete(timer)`). So `timersRef` grows by one dead handle per sounded celebration and is only ever drained on unmount (line 82-89).
- **Impact**: Slow unbounded growth of a `Set<Timeout>` across a multi-hour kiosk session — the exact runtime profile of a war-room wall. Not user-visible short-term, but it is a genuine leak in the one scenario the feature is built for, and `clearTimeout` on already-fired handles at unmount is wasted work.
- **Fix sketch**: Mirror the celebration pattern — inside the closer callback, call `timersRef.current.delete(closer)` after closing the context (assign to a named `const closer` first so the callback can reference it).
