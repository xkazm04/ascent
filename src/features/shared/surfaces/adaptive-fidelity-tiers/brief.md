# Adaptive fidelity tiers - showcase brief

subject: adaptive-fidelity-tiers
subcategory: feedback-and-style
digest: sha256:b28d9f28795d6750
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/feedback-and-style/adaptive-fidelity-tiers/adaptive-fidelity-tiers.md

## Scene concept

An ambient strata header (the brand's altimeter motif, drifting) with its fidelity instrument
underneath: one probe measures a seeded frame trace window by window and publishes one tier -
full / reduced / floor - that the header's two effects read at render from their own budget tables.
Every hard part of the subject is a region of the instrument: the window statistic that decides, the
lopsided ladder with its dead band, the settle deadline and its event-shaped re-arms, the idle-or-timeout
race with a declared default, the tables beside the effects, and the preference that stops the probe
from being created at all. A viewer presses "play session" and watches richness arrive, fall on one bad
window, refuse to climb on alternating good/neutral windows, climb again, and settle; or closes windows
of a chosen kind by hand.

## Techniques

### measured-not-declared-capability
- use_when matched: "deciding what statistic a device tier is computed from"
- mechanism to show: `percentile()` at p90 over a fixed-count window of 60 samples; the mean shown greyed beside it; absolute thresholds as rules on the bar chart; a straddled window logged as `discarded`; the declared-device strip refused; a derivation per constant
- region: `StatisticRegion.tsx`
- Ascent evidence: none found (grep: `rg "hardwareConcurrency|deviceMemory|navigator\.userAgent|isMobile" src` -> 0 hits; `rg "percentile|p90|p95" src` -> only benchmark/KPI percentiles, no frame timing; `rg "requestAnimationFrame" src` -> tweens and playheads, no sampler)
- deviation: no frame measurement and no declared-signal branch exist; the scene's frames are a seeded trace, not rAF intervals
- applications read: react--asymmetric-tier-transitions.md - numbers taken: a 120-sample window, p90, a 3 ms dead band criticised as too narrow against 60 Hz (this scene uses 13 ms and states why); nothing cited as Ascent's

### asymmetric-tier-transitions
- use_when matched: "wiring the rule that moves a device between fidelity tiers"
- mechanism to show: `closeWindow()` - one bad window down, catastrophic straight to the floor, three consecutive good windows up one rung, the dead band resets the counter; `TIER_COST_MS` makes the feedback loop real and the band is wider than the step
- region: `LadderRegion.tsx` (the window log + four window buttons)
- Ascent evidence: none found (grep: `rg -i "fidelity|qualityTier|useQuality" src` -> only the AI-usage ingest's `fidelity: "measured" | "allocated"`, unrelated). Adjacent only: `src/components/launch/useFleetData.ts` backoff (`backoffDelayMs(fails)` / `backoff.current.delete(login)` on success) - the mirror image
- deviation: no ladder; the nearest asymmetric rule runs the other way
- applications read: react--asymmetric-tier-transitions.md - mechanisms taken: the three-branch `evaluate()` with the dead-band `else` resetting the counter; its deviation (no skip-down) is what the scene's catastrophic branch fixes; nothing cited as Ascent's

### measurement-settle-budget
- use_when matched: "deciding when a capability probe is allowed to stop"
- mechanism to show: stability exit (3 unchanged windows) then the unconditional deadline resolving to the lower tier; the interval cleared by effect cleanup (`active` derived from phase); two named re-arm events, each a fresh budget, capped by `REARM_CAP`
- region: `SettleRegion.tsx`
- Ascent evidence: `src/components/launch/useFleetData.ts` `onVisible` - `if (Date.now() - lastStartedAt < POLL_INTERVAL_MS) return;` before `refreshAll()`, with the comment that a re-pull on every focus is a poll with extra steps (grep: `rg "visibilitychange" src` -> useFleetData.ts:223 + its tests)
- deviation: a poll with an event supplement, never a settled probe - the technique's own counter-case, unstated as a budget
- applications read: react--asymmetric-tier-transitions.md - numbers taken: a 15 s deadline from the first tick, a real stop (no further frame scheduled); its three shortfalls (no stability exit, no downward resolution, no re-arm) are the three things this region shows; nothing cited as Ascent's

### probe-deferral-to-idle
- use_when matched: "deciding when a capability probe first samples"
- mechanism to show: `unmeasured` with both handles armed; `fire(winner)` and the loser reported cancelled; `tierSource` separating declared default from measured; `DEFAULT_TIER = "reduced"` with its reason; reload shows the arrival
- region: `DeferralRegion.tsx`
- Ascent evidence: `src/components/ui/Defer.tsx` lines 84-91 - `requestIdleCallback(..., { timeout: DEFER_IDLE_TIMEOUT_MS })`, cancelled in cleanup; `src/components/ui/deferPolicy.ts` `DEFER_IDLE_TIMEOUT_MS = 500` "never hold content longer than this, even on a busy main thread" (grep: `rg "requestIdleCallback" src` -> Defer.tsx:85-86, deferPolicy.ts:10)
- deviation: the no-rIC fallback is `setTimeout(..., 0)`, not the deadline; a mount deferral, not a measurement, so no unmeasured state
- applications read: react--asymmetric-tier-transitions.md - mechanism taken: idle request plus a 2 s timer, `startMeasuring` cancelling the loser, both cancelled at teardown; the starting-at-"high" deviation is what `DEFAULT_TIER = "reduced"` answers; nothing cited as Ascent's

### per-tier-budget-tables
- use_when matched: "adding a visual effect that has a count or complexity knob"
- mechanism to show: `TIERS` once; `STRATA` (must) and `WASH` (should) typed `Record<Tier, ...>`; rows are parameters with one sub-part boolean; the floor row is 3 static lines, not zero; `ALL_LINES` allocated once, prefix drawn; row read at render; obligation ledger; the guide ratio; a pause control on the drift
- region: `BudgetRegion.tsx` + `StrataField.tsx` (the effect)
- Ascent evidence: none found (grep: `rg "Record<Tier" src` -> 0 hits outside this folder; `rg "LOOP_RUN_MS|DRIFT_MS" src` -> single-valued constants in aboutOrgLoopMotion.ts:19 and observatoryMotion.ts:15)
- deviation: every effect constant is single-valued - identical at every rung
- applications read: react--per-tier-budget-tables.md - mechanisms taken: `PARTICLE_COUNTS { high, medium, low }` typed against the vocabulary; allocate at the top row and `slice(0, COUNTS[tier])`; a floor of 8 not 0 for the effect that is a section's only life; the "read at mount" defect (`particlesRef` built once) the scene avoids by reading the row in the render body; the MUST/SHOULD/exempt gating contract; nothing cited as Ascent's

### preference-short-circuits-measurement
- use_when matched: "wiring a capability probe into a surface that also honours a reduced-motion preference"
- mechanism to show: `initialProbe()` returns `short-circuited` before scheduling for `reduced` or a non-auto control; the existence ledger; the key-driven re-creation in `useProbe` (teardown on, fresh budget off); the OS preference outranking the control; `auto` as the way back
- region: `PreferenceRegion.tsx`
- Ascent evidence: `src/components/ui/Defer.tsx` lines 56-58 - `mountsImmediately()` computed per render and `if (now || ready) return;` as the effect's first statement, `now` in the deps (grep: `rg "mountsImmediately" src` -> Defer.tsx, deferPolicy.ts and its test)
- deviation: three preference readers coexist; no product quality control, so no stored choice to get right or wrong
- applications read: react--asymmetric-tier-transitions.md - mechanism taken: the effect's first statements returning before any scheduling with `[framerReduced]` in the deps as the live teardown; its `settledRef` gap (off-on-off cannot restart) is why `schedule` here rebuilds the whole state; nothing cited as Ascent's

## Out of the read

- A real rAF sampler on this page. The scene's windows are a seeded trace so the jsdom test and a
  screenshot are reproducible and the scene cannot demote the reader's own machine; the reducer that
  consumes them is the real one. Said on screen and in the first technique's deviation.
- The plan-entitlement and build-gate contrasts in the golden path: prose distinctions with no
  region to render; the drawer's mechanism text does not restate them.
- The sparse re-probe counter-argument (one short window every few minutes for a surface left open
  for hours): a different system the technique asks to be chosen explicitly; the scene chooses the
  settled probe and says so via `REARM_CAP`.
- `inherited-default-override` (the settings-store rule the preference technique hands off to): the
  product control here is in-memory state with an `auto` chip, not a stored override.
