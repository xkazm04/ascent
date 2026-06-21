> Total: 3 findings (0 critical, 0 high, 2 medium, 1 low)

# Dev Inspector — combined bug+ui scan

## 1. Source label shows the call-site loc but is pinned to the innermost element
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **File**: src/app/_dev-inspector/DevInspector.tsx:204
- **Scenario**: Arm the inspector and hover a host element rendered by a shared/library component (so `pickDefaultIndex` returns a non-zero index, e.g. the call site is an outer wrapper). The cyan `target` highlight box is drawn at `hover.targetRect` (the default/call-site element via `chain[defaultIndex]`), but the floating `SourceLabel` — which displays `defaultLoc` (also the call-site) — is positioned with `rect={hover.pointerRect}`, i.e. anchored to the innermost element (`chain[0]`).
- **Root cause**: The label's anchor rect and its text come from two different chain entries. The text always reflects `defaultIndex`, but the position always uses index 0. They only coincide when `defaultIndex === 0`.
- **Impact**: When the default copy target differs from the hovered element (the common case for shared components — the whole reason `pickDefaultIndex` exists), the `File.tsx:LINE` chip hovers over the small inner element while pointing at a file that belongs to the larger outer (cyan-boxed) element. The label visually disagrees with the highlight, misleading the user about which element maps to the shown source.
- **Fix sketch**: Anchor the label to the element it describes: pass `rect={hover.targetRect}` to `SourceLabel` (the target box already uses `targetRect`), or carry an explicit `labelRect` alongside `defaultLoc` so chip text and chip position always come from the same chain entry.

## 2. Highlight boxes and source label detach from elements on wheel-scroll with a stationary cursor
- **Severity**: Medium
- **Lens**: bug-hunter
- **File**: src/app/_dev-inspector/DevInspector.tsx:134
- **Scenario**: Arm the inspector, hover an element to lock the highlight, then scroll the page with the wheel (or via keyboard) without moving the mouse. The page content scrolls but the `HighlightBox`/`SourceLabel` stay at their last `getBoundingClientRect()` (fixed) coordinates, so they no longer overlay the element under the cursor until the next `mousemove`.
- **Root cause**: Rects are recomputed only inside `onMove` (the `mousemove` listener). There is no `scroll`/`resize` listener to refresh `hover` while armed, and `position: fixed` boxes do not move with scrolled content.
- **Impact**: The overlay points at the wrong element during/after any scroll that isn't accompanied by mouse movement — confusing for a precision "which source line is this" tool, and a right-click would copy a loc that no longer matches what's visually highlighted.
- **Fix sketch**: While armed, add `scroll` (capture, passive) and `resize` listeners that re-derive `hover` from the element currently under the pointer (cache last `clientX/clientY` from `onMove` and re-run `buildChain`/rect math), or clear `hover` on scroll so a stale highlight never lingers.

## 3. setTimeout side effect inside the setState updater double-fires under React StrictMode
- **Severity**: Low
- **Lens**: bug-hunter
- **File**: src/app/_dev-inspector/DevInspector.tsx:96
- **Scenario**: Press `;` to enter nav mode. The `setMode` functional updater both returns the next state and, as a side effect, assigns `navTimer.current = setTimeout(...)`. React 19 StrictMode (which runs in development — the only environment this component mounts in) intentionally invokes state updaters twice, so two timers are created and only the second is stored in the ref; the first becomes an orphan that cannot be cleared by `clearTimeout(navTimer.current)`.
- **Root cause**: A non-idempotent side effect (creating a timer + writing a ref) lives inside a `setState` reducer, which violates the purity expectation for updaters and breaks under StrictMode's double-invocation.
- **Impact**: Dev-only and self-limiting — the orphan timer's callback (`setMode((cur) => cur === "nav" ? "off" : cur)`) is harmless — but it is a leaked timer and a latent foot-gun if the callback ever gains real effects. It can also cause the 2s nav-mode auto-cancel to behave inconsistently.
- **Fix sketch**: Move the timer scheduling out of the updater into an effect keyed on `mode` (start the 2s auto-cancel when `mode === "nav"`, clear it on cleanup), keeping the `setMode` updater pure.
