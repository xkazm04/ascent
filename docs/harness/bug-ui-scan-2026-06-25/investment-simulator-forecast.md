# Investment Simulator & Forecast — Bug + UI Scan
> Context: Investment Simulator & Forecast (Org Planning & Execution)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. "Track as initiative" silently drops extra dimensions and uses stale form state
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure / state-corruption
- **File**: src/components/org/plan/Simulator.tsx:141-165 (esp. 147-148, 154)
- **Value**: impact 8 · effort 3 · risk 2
- **Scenario**: A user builds a multi-leg what-if ("Raise D2→70 **and** D3→80 **and** D6→90"), runs Simulate, sees the combined projected lift, then clicks **Track as initiative**. The handler builds the payload from the live primary `dimId`/`target` state only (`title`, `dimId`, `targetScore: target`, `practiceId`) and sends no `fixes` — so the persisted initiative captures *just leg 1* (D2→70). The other legs vanish with no warning. Separately, because it reads live `dimId`/`target` rather than `result.fixes`, changing the dropdown after simulating (without re-running) tracks an initiative that disagrees with the projection shown on screen.
- **Root cause**: The initiatives API is single-dimension (`{dimId, targetScore, repos}`), but the simulator became multi-leg (SIM-2) without reconciling the "commit to plan" path; it also sources the commit from mutable form state instead of the immutable `result.fixes` the projection was computed from.
- **Impact**: The committed roadmap under-scopes what leadership reviewed — they approve a 3-dimension push and only one dimension is tracked. Misleading plan / data-fidelity loss.
- **Fix sketch**: Drive the commit from `result.fixes` (the snapshot that produced the projection). For multi-leg scenarios, either create one initiative per leg or disable/annotate the button ("tracks the primary dimension only") so the drop is explicit, not silent.

## 2. simulateFleet ADDS an absent dimension at target — a "raise" can LOWER a partial-scan repo
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / state-corruption
- **File**: src/lib/scoring/orgsim.ts:120-135 (line 127)
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: A partially-scanned repo (e.g. dims present = D1,D2 at 80, D3 absent) is in scope for "raise D3→70". The apply loop's guard is `if (cur == null || cur < f.target)`, so an **absent** dim is force-added at the target and `moved=true`. `recomputeRepo` renormalizes over *present* dims, so `before` excludes D3 (overall ≈80) but `after` now includes D3=70 — dragging the renormalized overall *down*. The repo is counted as `affected` yet shows a **negative** delta from a "raise", and "Biggest movers" (which filters `delta > 0`) hides the regression entirely.
- **Root cause**: Asymmetric present-dim sets between before/after: the projection treats "dimension never measured" as "currently below target and should be set to target", conflating absent with low.
- **Impact**: A what-if labeled a fleet improvement can report fewer points / wrong `affected` for partial scans, and the downside is invisible in the UI. Counterintuitive, untrusted numbers.
- **Fix sketch**: Only move a dimension that is present and below target (`cur != null && cur < f.target`), or explicitly decide-and-document the "introduce a missing dimension" semantics and surface negative movers too.

## 3. "Suggest moves" (ROI ranking) swallows API failures with no feedback
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / loading-state
- **File**: src/components/org/plan/Simulator.tsx:76-91 (lines 85-88)
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: `suggestMoves` only acts on `res.ok` and has an empty `catch`. If `/api/org/simulate` returns 404 ("No scanned repos to rank"), 503 ("requires a database"), 401/403 from `requireOrgRead`, or the network throws, the button spinner clears to "Suggest/Refresh" and nothing changes — `ranking` stays null/stale. The user clicks repeatedly with no idea why nothing appears.
- **Root cause**: Error branch is unhandled; unlike `run()`/`trackAsInitiative` (which surface `error`/`trackError`), the ranking path has no error state.
- **Impact**: Success theater — a failed request looks like "no suggestions". Confusing, hard to diagnose in the field.
- **Fix sketch**: On `!res.ok` set a visible message from `data.error`; in `catch` set a generic failure note. Reuse the existing `error`-style styling.

## 4. etaToNextLevel mis-buckets a fractional `current` — disagrees with levelForScore/currentLevel
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / silent-failure
- **File**: src/lib/maturity/forecast.ts:161-191 (line 163), vs 146 & model.ts:183-186
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: Bands are contiguous **integers** (L3 [45,64], L4 [65,84]). `levelForScore` rounds first (`clamp(Math.round(score))`), so 64.7→L4. But `etaToNextLevel` matches on the raw value: `findIndex(l => current >= l.band[0] && current <= l.band[1])`. A fractional `current` of 64.7 is in *no* band (>64 and <65), `findIndex` returns -1, `i` defaults to 0 (L1). For a rising trend the boundary becomes L2's floor (25); `exactDays = (25 − 64.7)/perDay < 0` → returns `null`. Result: a clearly-rising L4-rounded repo reports **no promotion ETA**, and `eta.fromLevel` (L1) contradicts `currentLevel` (L4).
- **Root cause**: Two different "which level is this score" code paths — one rounds, one doesn't. Maturity series happen to be integers today, but `forecastTrajectory` is generic and any fractional/averaged feed trips it.
- **Impact**: Latent: silently null/contradictory ETA + a fromLevel that disagrees with the headline level. A landmine the moment a non-integer series is fed in.
- **Fix sketch**: Round `current` once at entry to `etaToNextLevel` (or reuse `levelForScore(current)` to find the band index), so band-bucketing is consistent with the rest of the module.

## 5. Simulator form controls lack accessible labels
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/org/plan/Simulator.tsx:222, 230, 244-256, 258-265
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: The dimension `<select>` and the target `<input type="number">` (primary and per-extra) rely on adjacent visual-only text ("Raise"/"to"/"across", "and"/"to") that isn't programmatically associated. A screen-reader user hears an unlabeled "combobox" and "spin button"; the per-extra controls are indistinguishable from each other.
- **Root cause**: Inline sentence layout uses sibling `<span>`s for context rather than `<label htmlFor>`/`aria-label`, so the accessible name is empty.
- **Impact**: Keyboard/AT users can't tell what each control sets — degraded accessibility on the core planning surface.
- **Fix sketch**: Add `aria-label` (e.g. `aria-label="Dimension to raise"`, `aria-label="Target score"`) to each control, including the extra-leg select/input, indexing extras (`Dimension N`). No visual change.
