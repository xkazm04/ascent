# Feature Scout — Live War Room (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 1M / 1L

## 1. Goal / target countdown overlay on the wall
- **Severity**: Critical
- **Category**: feature
- **File**: src/app/org/[slug]/live/page.tsx:13 (calls `getOrgRollup(slug)` with no window/goal); src/components/org/LiveWarRoom.tsx:251-273 (headline tiles); src/components/org/plan/goalView.tsx:18-84 (unused goal model)
- **Scenario**: A leader runs the war room *during a push to hit a target* — "AI Adoption 60 by December", "reach AI-Native by Q3". The whole point of the big screen is rallying the room toward a number with a deadline.
- **Gap**: The org has a full, time-bound goals system — target, pace verdict (reached/on-pace/behind), trend ETA, deadline, and "which repos must move" laggards (`GoalProgressView`, `/api/org/goals`, `GoalsOverview`). The war room imports **none** of it. There is no target line, no "X points to goal", no deadline countdown anywhere on the wall (grep: `goal|target|countdown|deadline` returns zero matches in the live/war-room files). The headline tiles show only the current average against nothing.
- **Impact**: Every org leader running a maturity campaign. A war room without the goal it's fighting toward is a dashboard, not a war room — this is the difference between "here are our scores" and "we are 7 points and 12 days from winning." Highest-leverage feature: it reuses an existing, computed data model.
- **Fix sketch**: In `live/page.tsx`, fetch active goals (`getActiveGoals`/`getGoalProgress` from `lib/db/plan.ts`) alongside the rollup and pass the top goal as a `goal` prop. Add a goal banner in `WarRoomHeader` (target meter from `goalView.Meter`, `PaceChip`, a deadline countdown computed from `targetDate`), and overlay the target as a marker line on the relevant headline tile. ~0.5–1 day; data layer already exists.

## 2. Campaign baseline — "movement since the push started"
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/org/[slug]/live/page.tsx:13; src/lib/db/org-rollup.ts:76-107 (`OrgWindow`, `baseline`, cohort-matched `deltas`); src/components/org/LiveWarRoom.tsx:198-214 (stats memo)
- **Scenario**: The room wants to see how far the fleet has climbed *during this initiative* — "+8 org maturity since kickoff", a tile that goes green the moment net progress crosses zero.
- **Gap**: `getOrgRollup` already accepts an `OrgWindow` and returns a `baseline` snapshot plus cohort-matched `deltas` (overall/adoption/rigor) — purpose-built for period-over-period movement. The live page calls `getOrgRollup(slug)` with **no window**, so the war room only ever shows absolute scores. The movers ticker delta (`LiveWarRoom.tsx:118`) is per-repo vs its *last scan*, not campaign-to-date. No "since start" number exists on the wall.
- **Impact**: Leaders and the whole room — momentum is the emotional core of a war room. Showing climb-since-kickoff turns a static average into a story of progress and is nearly free given `computeWindowDeltas` already exists.
- **Fix sketch**: Pass a campaign-start date (from the active goal's `createdAt`, or a `?since=` param) into `getOrgRollup(slug, { start })`, then render `rollup.deltas.overall` as a "+N since kickoff" sub-line under each `AnimatedStat`. ~0.5 day.

## 3. Auto re-arm / live loop for an unattended wall display
- **Severity**: High
- **Category**: functionality
- **File**: src/components/org/LiveWarRoom.tsx:128-189 (`launch` is manual, one-shot); :224-227 (phase ends at `done`)
- **Scenario**: The war room is mounted on a TV for a multi-day push. Nobody is standing at the keyboard to re-click "Launch" — the wall should keep itself current as repos are re-scanned.
- **Gap**: The scan is strictly manual and single-shot — `launch` only fires on button click, and after `phase === "done"` the wall freezes on the last result with no re-arm (grep: `setInterval|auto.?refresh|poll|loop` returns zero matches in `components/org`). A wall left running shows a stale "done" board indefinitely.
- **Impact**: Anyone using this as an actual wall display (the stated use case). Without an auto-loop the "live" wall is live for exactly one run. High value for low cost and core to the kiosk story.
- **Fix sketch**: Add an opt-in "Auto-relaunch every N min" toggle (or `?loop=15` param) that schedules `launch()` on a `setInterval` while idle/done, guarded by the existing `abortRef` so it never overlaps a run. Persist the toggle in `localStorage`. ~0.5 day.

## 4. Kiosk / TV mode: fullscreen + screen wake-lock + shareable read-only link
- **Severity**: High
- **Category**: feature
- **File**: src/app/org/[slug]/live/page.tsx (no kiosk affordance); src/app/org/[slug]/layout.tsx:50-85 (hard auth/tenant gate); src/components/org/LiveWarRoom.tsx:229-248 (full chrome always shown)
- **Scenario**: Ops wants the war room on a hallway TV for the duration of a sprint — fullscreen, no nav chrome, screen never dimming, reachable without an engineer logging the TV into a GitHub-bound session.
- **Gap**: No fullscreen, no `wakeLock`, no kiosk layout (grep: `fullscreen|requestFullscreen|kiosk|wakeLock` returns **zero** matches repo-wide). The page renders inside the standard org `Frame` (SiteHeader/Footer/nav) with no distraction-free mode. And it sits behind the org layout's `canReadOrg` tenant gate (layout.tsx:76) — a TV with no session can't show a private org's wall. A `PUBLIC_ORG` open-read concept exists (`lib/authz.ts:41,64`) but there is no per-org signed/expiring **read-only share link** to put the wall on an unauthenticated screen.
- **Impact**: Every team that wants the wall literally on a wall — today that's blocked by auth-on-TV friction, screen sleep, and visible nav chrome. This is table-stakes for a "big-screen fleet view".
- **Fix sketch**: (a) Add a "Fullscreen / TV mode" button calling `requestFullscreen()` + `navigator.wakeLock.request("screen")`, hiding chrome via a `?kiosk=1` param. (b) Add a signed, expiring read-only share token route (e.g. `/live/shared/[token]`) that bypasses the session gate for a single org's rollup+SSE, mirroring the `PUBLIC_ORG` read path in `authz.ts`. ~1–1.5 days.

## 5. Sound / fanfare on real celebration events
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/components/org/LiveWarRoomCelebrations.tsx:1-28 (visual-only burst); src/components/org/LiveWarRoom.tsx:70-77,121-123 (`pushCelebration` on ai-native crossing)
- **Scenario**: A repo crosses into AI-Native mid-scan — the room should hear a chime/fanfare so heads turn even when nobody is staring at the screen.
- **Gap**: Celebrations are purely visual (emoji + CSS burst). There is no audio anywhere in the codebase (grep: `new Audio|AudioContext|playSound|chime|fanfare` returns **zero** matches). The celebration trigger (`posture === "ai-native" && prev?.posture !== "ai-native"`) is a perfect, already-wired hook for a sound cue that goes unused.
- **Impact**: The room — sound is what makes a war-room moment land emotionally. Cheap to add and amplifies an event the code already detects.
- **Fix sketch**: In `pushCelebration`, play a short bundled audio clip via `new Audio()`, gated behind a user-toggled, default-off "Sound" control (browsers block autoplay until a gesture; the Launch click satisfies it) and honoring `prefers-reduced-motion`. Optionally a softer "tick" on each landed result. ~0.5 day.

## 6. Leaderboard rank-change & "biggest mover" indicators
- **Severity**: Low
- **Category**: feature
- **File**: src/components/org/LiveWarRoomLeaderboard.tsx:16-44 (sorts by score, no rank memory); src/components/org/LiveWarRoom.tsx:216-222 (`leaderboard` memo)
- **Scenario**: As results land the board reshuffles — viewers want to see *who overtook whom* ("▲3 places", a crown on the top climber), not just the new order.
- **Gap**: The board animates row position (CSS `top` transition) but carries no previous-rank memory and shows no rank-delta or biggest-mover marker (grep: `rankDelta|prevRank|biggest mover|overtake|crown` matches only the unrelated badge route). The data to compute it (the seeded standing and each `delta`) is already in state.
- **Impact**: The room — a "who jumped the most" call-out adds competitive drama and reads naturally on a leaderboard. Polish, but it makes the reshuffle legible.
- **Fix sketch**: Track a `prevRankRef` keyed by `fullName`, diff against the new `leaderboard` order, and render a small "▲N / ▼N" rank-delta chip plus a crown on the largest positive `delta` this run. ~0.5 day.
