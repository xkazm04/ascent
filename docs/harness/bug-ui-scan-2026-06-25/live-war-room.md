# Live War Room — Bug + UI Scan
> Context: Live War Room (Org Planning & Execution)
> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)

## 1. `launch()` finally nulls the shared abort ref unconditionally → stale run clobbers the new run, enabling concurrent duplicate scans
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition
- **File**: src/components/org/LiveWarRoom.tsx:181-243 (esp. 240-242, 233-239)
- **Value**: impact 7 · effort 2 · risk 3
- **Scenario**: User clicks **Stop** then **Launch** again within the same moment (or auto-relaunch fires right after a manual stop). `stop()` aborts ctrl1 and sets `abortRef.current = null`; launch #2 sees the null guard, proceeds, and stores `abortRef.current = ctrl2`. A microtask later, launch #1's aborted `await readSSE` rejects → its `catch` runs, then its `finally` executes `abortRef.current = null`, **clobbering ctrl2**. Now a scan is streaming (phase "running" was overwritten to "idle" by ctrl1's catch) but `abortRef` is null: the next Launch click passes the `if (abortRef.current) return` concurrency guard and starts a *second* live scan over the same fleet, and the Stop button's `abortRef.current?.abort()` no-ops, orphaning the stream.
- **Root cause**: The single shared `abortRef` is assumed to always point at "the current run," but `finally` clears it without checking whether a newer run already took ownership.
- **Impact**: Duplicate full-fleet scans burn prepaid scan credits twice, double-fold SSE results into the wall, and leave a dead Stop button — money error + state corruption on the credit-metered scan path.
- **Fix sketch**: Capture the controller per invocation and guard ownership: `finally { if (abortRef.current === ctrl) abortRef.current = null; }`; likewise gate the catch's `setPhase`/`setError` on `abortRef.current === ctrl`. That makes the whole stale-run-clobber class impossible regardless of click timing.

## 2. Headline AI-Adoption / Engineering-Rigor tiles are understated — average divides by all scored repos, even those missing the axis
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/components/org/liveWarRoomFold.ts:95-111 (sum helper line 99; avgAdoption 106, avgRigor 107)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: `computeStats` builds `s = repos with overall != null`, sets `n = s.length`, then `avgAdoption = sum(r.adoption ?? 0) / n`. Both the seed (`toLiveRepoSeeds`: `adoption: r.latest?.adoption ?? null`) and the live fold (`classifyRepoEvent`: `adoption: finiteOrNull(...)`) can legitimately produce a scored repo whose `adoption`/`rigor` is `null`. Those nulls are coerced to `0` in the sum but still counted in the denominator `n`. Example: 10 repos scored, 5 carry `adoption = 80`, 5 carry `adoption = null` → the tile shows `(5·80)/10 = 40` instead of `80`.
- **Root cause**: Treating "axis absent" as "axis = 0" while keeping it in the divisor — `?? 0` in the numerator but no matching filter on the count.
- **Impact**: The "AI Adoption" and "Engineering Rigor" headline numbers projected on the exec war-room wall read materially too low whenever any scored repo lacks that axis — wrong results on the wall's most prominent figures.
- **Fix sketch**: Average each axis over only the repos that actually carry it: e.g. `const withAdoption = s.filter(r => r.adoption != null); avgAdoption = withAdoption.length ? Math.round(sum over withAdoption / withAdoption.length) : null;` (same for rigor). Keep `avgOverall` as-is since `s` is already the overall-present set.

## 3. Clipboard failure discards the freshly-minted TV share link with only a generic error and no manual-copy fallback
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: error-handling
- **File**: src/components/org/LiveWarRoomHeader.tsx:81-97 (clipboard write line 91, catch 94-96)
- **Value**: impact 4 · effort 3 · risk 2
- **Scenario**: `shareTvLink()` POSTs to `/api/org/live-share`, gets back a valid `path`, then `await navigator.clipboard.writeText(...)`. If `writeText` rejects (non-secure context, denied permission, no clipboard API — common on some kiosk/embedded browsers and any http origin), it falls into the same `catch` that handles mint failures and shows "Share failed." The link was successfully created server-side but the owner is never shown the URL, so it's unrecoverable from the UI.
- **Root cause**: The mint step and the copy step share one try/catch with one generic failure message, conflating "couldn't create a link" with "created it but couldn't auto-copy."
- **Impact**: Owner cannot publish the wall to a TV even though a valid token exists — a dead-end on the headline WAR-4 sharing feature, with a misleading "failed" message.
- **Fix sketch**: On a successful mint, store the URL in state; attempt clipboard copy separately, and on copy failure render the URL in a read-only/selectable field (`Couldn't auto-copy — here's the link:`) so it can be copied manually.

## 4. Auto-relaunch 15-min timer restarts on every visibility change / dependency churn, so it can perpetually defer
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/components/org/LiveWarRoom.tsx:266-274 (timer), 70-76 (visibility sync)
- **Value**: impact 4 · effort 3 · risk 2
- **Scenario**: The auto-loop effect schedules a single `setTimeout(launch, 15min)` and lists `visible` in its deps. Each `visibilitychange` flips `visible`, re-runs the effect, clears the pending timer, and starts a fresh 15-minute countdown. On a wall whose tab is periodically backgrounded/foregrounded (rotating dashboards, screensaver wake cycles, OS focus stealing more often than every 15 min), the unattended scan never actually relaunches — the feature silently does nothing.
- **Root cause**: A fixed-duration timer recreated from scratch whenever any gating dependency changes, with no notion of elapsed time or a target wall-clock deadline.
- **Impact**: The advertised "auto-relaunch every 15 min" unattended-display feature can quietly never fire, leaving a stale wall — success theater (toggle is on, nothing happens).
- **Fix sketch**: Track a `nextRunAt` timestamp (set once when the loop arms / a run completes) and on each effect run schedule `setTimeout` for `Math.max(0, nextRunAt - Date.now())`, so re-arming after a visibility flip resumes the remaining time instead of resetting the full interval.

## 5. Run progress bar and reshuffling leaderboard lack semantic roles for assistive tech
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/org/LiveWarRoomHeader.tsx:220-231; src/components/org/LiveWarRoomLeaderboard.tsx:16-44
- **Value**: impact 3 · effort 3 · risk 1
- **Scenario**: The scan progress bar is a pair of plain `<div>`s with an inline `width: %` and no `role="progressbar"`/`aria-valuenow`/`aria-valuemax`, so screen-reader users only hear the separate "scanning X…" caption, never the completion percentage. The Fleet leaderboard renders ranked repos as absolutely-positioned `<div>`s (positioned by `top` for the reshuffle animation) rather than an ordered list/table, so the ranking conveys no list semantics or position-in-set to assistive tech.
- **Root cause**: Visual-first markup — the progress fill and the y-translate animation were prioritized over conveying the same structure non-visually.
- **Impact**: Reduced accessibility of the two most information-dense surfaces of the wall; no functional break for sighted users.
- **Fix sketch**: Add `role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}` to the progress track. Wrap leaderboard rows in an `<ol>` (rows as `<li>`) — the absolute positioning still works on `<li>` elements — so rank order is exposed natively.
