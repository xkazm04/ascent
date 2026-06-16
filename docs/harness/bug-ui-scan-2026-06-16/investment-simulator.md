# Investment Simulator & Forecast — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 5

## 1. `NaN` target passes validation and produces a silent no-op projection
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Input validation / simulation math
- **File**: src/app/api/org/simulate/route.ts:46 (and src/lib/scoring/orgsim.ts:113,127)
- **Scenario**: A client posts `{ org, dimId: "D2", target: NaN }` — or `{ fixes: [{ dimId: "D2", target: NaN }] }`. This is reachable from the real UI: the number `<input>`'s `onChange` does `setTarget(Number(e.target.value))`, and `Number("abc")` (or other non-numeric input states) yields `NaN`. The route's guard is `typeof f.target === "number"`, and `typeof NaN === "number"` is `true`, so the request sails through.
- **Root cause**: The validation checks the *type* but not finiteness. Downstream, `simulateFleet` normalizes the leg with `clamp(Math.round(f.target))`; `Math.round(NaN) === NaN` and `clamp(NaN)` returns `NaN` (because `Math.max(0, Math.min(100, NaN))` is `NaN`). In the after-loop the move test is `cur < f.target`, and `cur < NaN` is always `false`, so **no repo is ever marked moved**.
- **Impact**: The endpoint returns HTTP 200 with `before === after`, `affected: 0`, `promotions: 0` — a perfectly valid-looking "this change would do nothing" result — instead of a 400. A leader reading that concludes the investment is worthless when in fact the request was malformed. Silent wrong-answer is worse than an error.
- **Fix sketch**: In the route's per-fix loop, require `Number.isFinite(f.target)` (and ideally `0 <= f.target <= 100`) alongside the existing `typeof` check; reject otherwise with the existing 400 message. Defensively, also drop non-finite legs in `simulateFleet`'s normalize step.

## 2. Rank-mode and fix `target` accept out-of-range / non-finite values, then silently clamp
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Input validation / range
- **File**: src/app/api/org/simulate/route.ts:36 (rank) and :46 (fixes)
- **Scenario**: `{ org, rank: true, target: -50 }`, `{ ... target: 1e9 }`, or `{ ... target: NaN/Infinity }`. Rank mode's guard is only `typeof body.target === "number" ? body.target : 70`, so `-50`, `1e9`, `Infinity`, and `NaN` all pass. Same for fix targets (after finding #1's finiteness fix, range is still unchecked).
- **Root cause**: No range/finite clamp at the boundary. `rankFleetInvestments` does `clamp(Math.round(target))`, so `-50 → 0`, `1e9 → 100`, `Infinity → 100`, `NaN → NaN`. "Raise everything to 0" is a guaranteed no-op (every gain ≤ 0 → UI filters `gain > 0` → "No dimension moves the fleet"); `NaN` target makes every `cur < NaN` false so all gains are 0 with the same misleading empty result.
- **Impact**: The server silently substitutes a different target than the caller asked for, with zero feedback. A `-50` or `NaN` request looks like "investing here is pointless" rather than "your target was invalid." The clamped value also disagrees with what the UI echoes (see finding #4).
- **Fix sketch**: Validate at the route: coerce rank `target` only when finite and within `0..100` (else 400 or fall back to 70 with an explicit note); apply the same `Number.isFinite` + range check to fix targets so the API rejects rather than silently clamps.

## 3. Out-of-range fix target is clamped server-side but the echoed `fixes` disagree with the saved scenario
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Data consistency
- **File**: src/lib/scoring/orgsim.ts:113 (and Simulator.tsx:79, 168)
- **Scenario**: User types `target = 250` (typed values bypass the input's `max={100}`; HTML only constrains spinner steps), runs the sim, then clicks **Save scenario** / **Track as initiative**.
- **Root cause**: `simulateFleet` clamps the projection's `fixes` to `clamp(Math.round(250)) = 100`, so `projection.fixes` carries `target: 100`. But the *UI's* `target` state is still `250`: `saveScenario` builds its label from `result.fixes` (clamped → "D2→100"), while `trackAsInitiative` posts `targetScore: target` — the **un-clamped 250** — and titles it "Raise D2 … to 250". The simulated numbers (computed at 100) and the persisted initiative (target 250) now describe different things.
- **Impact**: A tracked initiative records an unreachable target (250) whose projected impact was actually computed at 100; the saved-scenario label and the initiative title disagree. Downstream goal/initiative math keys off `targetScore`.
- **Fix sketch**: Clamp `target` to `0..100` at the UI boundary (see finding #4) so state, projection, save-label, and initiative all share one value; or have `trackAsInitiative` post `result.fixes[0].target` (the already-clamped value) instead of raw `target`.

## 4. Number inputs allow out-of-range / NaN with no clamping and a display that lies
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: Input UX / live-update feedback
- **File**: src/components/org/plan/Simulator.tsx:250 (primary), :283 (extra legs)
- **Scenario**: User clears the field, or types `250`, `-5`, or non-numeric text into the "to ___" target box.
- **Root cause**: `onChange={(e) => setTarget(Number(e.target.value))}` with only HTML `min={0} max={100}`. HTML `min`/`max` do **not** constrain typed values — only spinner increments — so `target` becomes `250`/`-5`; `Number("")` is `0` (clearing the field silently snaps to 0); `Number("abc")` is `NaN` (the field renders blank and feeds the silent no-op in finding #1). The header button then reads "Suggest (→ 250)" and the scenario chip shows "to 250" while the server computes and returns results clamped to 100 — the UI presents a value the engine never used.
- **Impact**: Misleading inputs and results with no inline correction; a user can run a meaningless simulation (target 0 from an empty box, NaN from a typo) and never be told why "nothing changes."
- **Fix sketch**: Clamp on change/blur — `setTarget(Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))))` — or keep raw text in state and validate before enabling **Simulate**, surfacing an inline "0–100" hint. Apply identically to the extra-leg inputs at :283.

## 5. Simulator controls have no labels and async result/error states aren't announced
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Accessibility (a11y)
- **File**: src/components/org/plan/Simulator.tsx:242-257 (controls), :314 (error), :316 (result)
- **Scenario**: A screen-reader user operates the simulator: picks a dimension, sets a target, runs it, and the request succeeds or fails.
- **Root cause**: The dimension `<select>` and target `<input>` have no `<label htmlFor>` or `aria-label` — the visible "Raise / to / across" are plain `<span>`s, not associated labels, so the controls announce only generic roles. The **Simulate** button toggles to "Simulating…" with no `aria-busy`; the error `<p>` (:314) and the entire result block (:316) render with no `aria-live` region, so neither a completed projection nor a failure is announced. (Confirmed: the file contains zero `aria-*`, `htmlFor`, `role`, or `sr-only` attributes.)
- **Impact**: Non-sighted users can't tell what each control adjusts, nor whether a simulation is running, completed, or errored — the core interaction is effectively unusable assistively.
- **Fix sketch**: Add `aria-label` (or wire the spans as `<label htmlFor>`) to the select and both number inputs; add `aria-busy={busy}` to the Simulate button; wrap the error and result summary in `aria-live="polite"` regions (or add `role="status"`) so completion and failure are announced.
