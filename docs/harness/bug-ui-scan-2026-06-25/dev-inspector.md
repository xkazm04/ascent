# Dev Inspector — Bug + UI Scan
> Context: Dev Inspector (Onboarding, Shell & AI Standard)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

## 1. Highlight boxes & label go stale on scroll/reflow
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/app/_dev-inspector/DevInspector.tsx:134-171, 198-204
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: Arm the inspector (`;` then `i`), hover an element so the cyan box snaps onto it, then scroll the page with the wheel/trackpad *without moving the pointer*. The highlight box, pointer box and `SourceLabel` chip stay frozen at their old viewport coordinates and now visually point at a different element than the one the HUD breadcrumbs describe.
- **Root cause**: `onMove` snapshots `getBoundingClientRect()` into `hover` only on `mousemove` (lines 142-147). The boxes are `position: fixed` using those captured rects, but nothing re-measures on `scroll`/`resize`/wheel — events that move elements without firing `mousemove`.
- **Impact**: A source-locator that points at the wrong element after a scroll produces a misleading copy/highlight — the exact failure the tool exists to prevent. UX degradation / wrong result for a dev workflow.
- **Fix sketch**: While armed, also listen for `scroll` (capture) and `resize`, and either clear `hover` or recompute the three rects from the stored `chain` elements via `requestAnimationFrame`. Storing the elements (already in `chain`) and re-reading rects on a rAF tick makes the stale-rect class impossible.

## 2. SourceLabel is anchored to the innermost element but shows the call-site path
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/app/_dev-inspector/DevInspector.tsx:200-204; src/app/_dev-inspector/devInspectorUi.tsx:56-82
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: Hover a shared/library element (e.g. a `/ui/Button.tsx`) wrapped by a call site (`src/app/page.tsx`). The purple *dashed* pointer box is drawn at the innermost element; the cyan *solid* target box is drawn around the call-site element; but the cyan `SourceLabel` chip — which displays `page.tsx:NN` (the call site) — is positioned at `hover.pointerRect`, i.e. floating over the *purple* innermost box, far from the cyan box whose color it shares.
- **Root cause**: Line 204 passes `rect={hover.pointerRect}` (innermost) while `loc={defaultLoc}` (call site). The label's color (`ACCENT` cyan) matches the target box, but its position matches the pointer box, breaking the color→region association the two-box scheme sets up.
- **Impact**: Confusing read — the developer sees the call-site filename pinned to the wrong (inner) element, while the cyan region it belongs to has no label. Misdirects the eye in the tool's core interaction.
- **Fix sketch**: Anchor the chip to `hover.targetRect` (the element whose `loc` it shows), or render two chips (one per box) colored to match each box.

## 3. setMode updater schedules a timer — impure reducer leaks under StrictMode
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption
- **File**: src/app/_dev-inspector/DevInspector.tsx:93-105
- **Value**: impact 4 · effort 3 · risk 3
- **Scenario**: Press `;` to enter nav mode. React (dev StrictMode, on by default in Next.js) invokes the `setMode` updater twice. `clearTimeout(navTimer.current)` runs once (outside the updater), but `navTimer.current = setTimeout(...)` runs inside the updater both times, so the first timer handle is overwritten and never cleared — it fires ~2s later and runs an extra `setMode((cur) => cur === "nav" ? "off" : cur)`.
- **Root cause**: A state-updater function must be pure; here it performs a side effect (scheduling a timeout and mutating a ref). Double-invocation therefore double-schedules and leaks one timer; the orphaned timer can flip nav→off at an unexpected moment.
- **Impact**: Minor in practice (the extra fire is usually a no-op), but it is a genuine effect-in-reducer anti-pattern and a timer leak; under fast toggling it can auto-cancel nav mode unexpectedly.
- **Fix sketch**: Move the 2s auto-off scheduling out of the updater into an effect keyed on `mode === "nav"` (set timer on enter, clear on cleanup), keeping the `setMode` updater pure.

## 4. Rapid `;`→`i` can miss arming due to stale `mode` closure
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/app/_dev-inspector/DevInspector.tsx:88-122
- **Value**: impact 3 · effort 4 · risk 3
- **Scenario**: Press `;` then `i` in very quick succession (faster than React commits the state change and the keydown effect re-subscribes). The `i` branch guard `mode === "nav"` reads `mode` from the *previous* closure (still `"off"`), so the keypress is ignored and the inspector silently fails to arm; the user must press `i` again within the 2s window.
- **Root cause**: The keydown effect depends on `[mode]` and reads `mode` from closure for the `i`/`Esc` branches, while `;` uses a functional updater. Between the `;` dispatch and the effect re-subscribe there is a window where the handler still sees the old `mode`.
- **Impact**: Occasional "I pressed `i` and nothing happened" — low, self-correcting via retry, dev-only.
- **Fix sketch**: Track `mode` in a ref (updated in an effect) and read the ref inside the handler, or consolidate all transitions through a single functional `setMode` so no branch depends on a captured `mode`.

## 5. Single unmodified `;` is captured globally; HUD rows lack focus-visible state
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/app/_dev-inspector/DevInspector.tsx:88-122; src/app/_dev-inspector/devInspectorUi.tsx:96-118
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: With focus on any non-input element (body, a `<button>`, a `<div tabindex>`), pressing the bare `;` key is `preventDefault`-ed and pops the nav HUD — colliding with any single-key app shortcut bound to `;` during development. Separately, the `CrumbRow` copy buttons render no `:focus-visible` styling and copy is only reachable via right-click, so the HUD is effectively mouse-only.
- **Root cause**: The activation key is a single unmodified character registered with `capture: true` (no chord/modifier), and the HUD `<button>`s style `cursor`/`background` but omit any focus outline (line 99-111).
- **Impact**: Keyboard-shortcut interference for developers and a non-keyboard-operable HUD; low because it is a dev-only overlay.
- **Fix sketch**: Require a modifier or a two-key chord that is less collision-prone, and add a `:focus-visible` outline to `CrumbRow` (plus an `aria-label` on the copy buttons) so the breadcrumb HUD is keyboard-navigable.
