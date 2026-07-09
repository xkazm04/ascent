# Investment Simulator & Forecast — bug-hunter + ui-perfectionist scan

> Context: Investment Simulator & Forecast (group: Org Planning & Execution)
> Files scanned: 6
> Total: 7 findings (Critical: 0, High: 1, Medium: 3, Low: 3)

The numerical core is unusually well-hardened: divide-by-zero, NaN targets, partial
scans, ceiling/floor ETAs, `lowData` overconfidence, and unbounded projection are all
already clamped/guarded (and pinned by tests). No NaN reaches the UI, and `/api/org/simulate`
correctly gates on the ACTIVE `requireOrgRead`/`canReadOrg` wall (not the dormant
`isAuthConfigured`) — so no authz finding. The remaining issues are an input-amplification
DoS, two stale/rounding silent-wrong-output bugs, a clock-anchoring bug, and UI polish.

## 1. Uncapped `fixes[]` length amplifies into an O(repos × fixes) event-loop stall
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dos-amplification
- **File**: src/app/api/org/simulate/route.ts:45
- **Scenario**: A caller POSTs `{ org: "public", fixes: [ …180k copies of {dimId:"D2",target:70} ] }`. Every element passes per-fix validation (dimId D1..D9, target 0..100), so the length gate never triggers. `simulateOrgFixes` → `simulateFleet` then loops `for (const f of fixes)` **inside** `repos.map` (orgsim.ts:129), i.e. `repos × fixes` iterations, each doing a `{...dims}` spread. With ~100 fleet repos and a ~4.5 MB body that is ~10^7–10^8 field copies — a multi-hundred-ms to multi-second synchronous block per request.
- **Root cause**: The route validates each fix's *content* but never bounds the *count* of the array; the array length is an attacker-controlled loop bound multiplied by the fleet size.
- **Impact**: Repeated requests stall the single-threaded Node event loop, degrading every concurrent tenant on the instance. Reachable unauthenticated against `PUBLIC_ORG` (the open funnel), otherwise by any member.
- **Fix sketch**: Cap `rawFixes` (there are only 9 dimensions, so `if (rawFixes.length > 9) return 400`), and dedupe by `dimId` before calling `simulateOrgFixes`.

## 2. "Suggest moves" hides band-promoting dimensions whose fleet-average lift rounds to 0
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-wrong-output
- **File**: src/components/org/plan/Simulator.tsx:74
- **Scenario**: `rankOrgInvestments` returns `gain = round(after.avgOverall) − round(before.avgOverall)` (orgsim.ts:203). On a large fleet, a move that pushes one repo across a band (64→65, L3→L4) changes the average by a fraction that rounds to 0 → `gain = 0` but `promotions = 1`. The client does `.filter((r) => r.gain > 0)` and drops it, so the single most valuable recommendation (an actual promotion) never appears.
- **Root cause**: Ranking value is a difference of two *rounded* integers; the UI treats `gain === 0` as "no value", ignoring `promotions`.
- **Impact**: The "where should we invest?" panel silently omits the exact moves a leader wants — promotion-generating ones — steering investment toward higher-average-lift but lower-real-payoff dimensions.
- **Fix sketch**: `.filter((r) => r.gain > 0 || r.promotions > 0)`; in `RankPanel` render `+{gain} avg` and the `↑` count so a promotion-only move still reads as valuable.

## 3. Editing scope/dimension after "Simulate" leaves a stale projection, and "Track" reads the LIVE scope
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale-state
- **File**: src/components/org/plan/Simulator.tsx:148
- **Scenario**: User sets scope = {repoA, repoB}, clicks Simulate (projection computed for A,B), then opens the repo picker and changes scope to {repoC} — `toggle` (:90) does not clear `result`, so the on-screen projection still shows the A,B numbers. Clicking **Track as initiative** uses `scope.size > 0 ? [...scope] : result.repos…` = {repoC}, creating an initiative for a repo set that was never the one projected/reviewed.
- **Root cause**: `result` is a snapshot but the form state (`scope`) it was derived from is mutable and un-invalidated; `trackAsInitiative` sources repos from live `scope`, not from what produced `result` (the same drift class the code already fixed for `dimId`/`target` via `result.fixes`).
- **Impact**: Leadership commits a tracked initiative whose repo scope disagrees with the projection they approved — a silent scope mismatch.
- **Fix sketch**: On any form change (`toggle`, `setDimId`, `setTarget`, extras) clear `result`; and persist the concrete scope inside the projection (e.g. return the in-scope fullNames) so `trackAsInitiative` reads *that*, not live `scope`.

## 4. ETA date is anchored on the last observation, not "now" — sparse scans print a past/wrong crossing date
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: clock-anchoring
- **File**: src/lib/maturity/forecast.ts:194
- **Scenario**: `etaToNextLevel` computes `date = new Date(lastT + days*DAY_MS)`, where `lastT` is the most recent *observation's* timestamp and `days` is measured from that same point. If the latest scan is 30 days old and `days = 5`, `forecastHeadline` (:302) renders "…in ~5 days (≈ <lastScan+5d>)" — a date ~25 days in the past.
- **Root cause**: The module deliberately avoids `Date.now()` for testability, but the *absolute* date bakes in an assumption that `lastT ≈ present`. `days` (relative to last obs) is correct; the absolute date is not, once there's a data-freshness gap.
- **Impact**: A leader-facing headline shows a promotion/demotion date that can already be in the past when scan cadence is weekly/monthly — undermines trust and planning.
- **Fix sketch**: Thread the caller's `nowMs` (already injected in `projectGoal`) into `forecastTrajectory`/`etaToNextLevel` and compute the date as `now + max(0, days − staleDays)*DAY_MS`, or surface `days` as "from last scan" explicitly.

## 5. Target number inputs don't enforce the server's 0..100 range client-side
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: input-validation
- **File**: src/components/org/plan/Simulator.tsx:201
- **Scenario**: `min={0} max={100}` only constrain the spinner/validation, not typed values, and `onChange` does no clamping: typing `150` (or `-5`) sets `target = 150`, and Simulate then hits a server `400` ("target: a number in 0..100"). The extra-dimension inputs (:236) share this.
- **Root cause**: Client input constraints don't mirror the route's hard validation; the value is passed through verbatim.
- **Impact**: A user gets an opaque server error instead of being prevented from entering an invalid target — a small but avoidable friction on the primary control.
- **Fix sketch**: Clamp in the handler: `setTarget(Math.max(0, Math.min(100, Number(e.target.value) || 0)))`, and disable Simulate while the value is out of range.

## 6. A repo with an entire axis unmeasured scores that axis 0, mislabeling its posture
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/scoring/orgsim.ts:79
- **Scenario**: `recomputeRepo` derives `adoption`/`rigor` via `axisScore(…, isPresent)`. If a persisted scan has *no* adoption dimensions present (D1, D4, D7 all absent — possible under detector recovery), `axisScore` hits `wsum === 0 → return 0` (model.ts:296). `overall` meanwhile renormalizes over the present rigor dims and can be high (e.g. 80/L4). `postureFor(0, high)` then buckets the repo as "Solid but Manual" (adoption below threshold).
- **Root cause**: The partial-scan renormalization excludes absent dims from `overall`, but a *wholly* absent axis has nothing to renormalize over, so it defaults to 0 and is treated as "measured zero" rather than "unknown".
- **Impact**: A high-overall repo is shown in a contradictory low-adoption posture in the before/after posture mix. Edge (requires a full axis to be missing), and both `before` and `after` share it so the *delta* stays sound.
- **Fix sketch**: When an axis has zero present weight, treat it as "N/A" (exclude from the posture decision) rather than 0, or fall back to the overall score for that axis.

## 7. Primary dimension `<select>` isn't filtered against the extra legs, allowing a duplicate leg
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: component-consistency
- **File**: src/components/org/plan/Simulator.tsx:193
- **Scenario**: The extra-dimension selects filter out already-used dims (`d.id === e.dimId || !used.has(d.id)`, :222), but the primary select lists **all** dims (:194). After adding an extra `D3→70`, the user can switch the primary select to `D3`, producing `fixes = [{D3,70},{D3,70}]`. The projection is unaffected (`simulateFleet` is idempotent per dim) but the scenario line renders "D3→70 + D3→70".
- **Root cause**: Asymmetric option filtering between the primary control and the extras.
- **Impact**: Confusing duplicate leg in the scenario summary and (were multi-leg tracking enabled) a redundant initiative; purely cosmetic today.
- **Fix sketch**: Filter the primary `<select>` options the same way — `dims.filter((d) => d.id === dimId || !extras.some((e) => e.dimId === d.id))`.
