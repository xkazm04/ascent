# Dev Inspector — bug-hunter + ui-perfectionist scan

> Context: Dev Inspector (group: Onboarding, Shell & AI Standard)
> Files scanned: 3
> Total: 5 findings (Critical: 0, High: 0, Medium: 1, Low: 4)

**Priority question — is this reachable in production? NO.** `src/app/layout.tsx:6` imports `DevInspector`, but it is rendered only at `src/app/layout.tsx:86` behind `process.env.NODE_ENV === "development" && <DevInspector />`. A production build statically replaces `process.env.NODE_ENV` with `"production"`, so the branch folds to `false`, the component never mounts, and the side-effect-free module is tree-shaken from the client bundle. Source-path exposure additionally requires `data-loc` stamping, which is gated behind `DEV_INSPECT === "1"` (`next.config.ts:30`, opt-in via `npm run dev:inspect`). The guard is correct and there is no prod leak — no finding here. This is a well-engineered, previously-audited dev-only tool; the remaining findings are genuine but low-stakes and dev-scoped.

## 1. Armed-mode HUD traps pointer events in the bottom-left corner
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: overlay-pointer-events
- **File**: src/app/_dev-inspector/devInspectorUi.tsx:127 (with src/app/_dev-inspector/DevInspector.tsx:240)
- **Scenario**: The overlay wrapper is `pointerEvents:"none"`, but the HUD `PANEL` sets `pointerEvents:"auto"`. While armed, the fixed bottom-left panel (up to 460px wide) intercepts hover and clicks over whatever app UI sits behind it. `onMove` even early-returns on `insideHud`, so that region can't be inspected or clicked.
- **Root cause**: The doc comment claims "left-click is left alone so the app stays usable while armed," but that guarantee silently excludes the panel's footprint.
- **Impact**: A developer inspecting a component in the bottom-left cannot reach it; clicks land on the HUD instead. Confusing, dev-only.
- **Fix sketch**: Make the panel non-interactive by default and only enable `pointerEvents` on the crumb buttons, or move/shrink the panel when a hover target overlaps it. At minimum, allow click-through for empty panel padding.

## 2. Impure DOM/window reads during render
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: react-purity
- **File**: src/app/_dev-inspector/DevInspector.tsx:234 (with devInspectorUi.tsx:59-60)
- **Scenario**: `const mappingOn = document.querySelector("[data-loc]") !== null` runs in render, as do `window.innerWidth/innerHeight` in `SourceLabel`. These read live browser state during render rather than in an effect/layout pass.
- **Root cause**: Assumes render is a safe place to query the DOM; it isn't under React's concurrent rendering (reads can tear or go stale until the next re-render, which here only happens on hover/mode change).
- **Impact**: `mappingOn` can transiently show "Source mapping is OFF" after a client navigation until the next mouse move; harmless but incorrect momentarily.
- **Fix sketch**: Compute `mappingOn` in a `useEffect`/`useState` (re-check on arm), and read viewport size via a resize-synced ref rather than in render.

## 3. Global capture-phase `preventDefault` on `;` collides with app shortcuts
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: keyboard-collision
- **File**: src/app/_dev-inspector/DevInspector.tsx:102-110
- **Scenario**: The keydown listener is registered on `window` with `capture:true` (line 125) and calls `e.preventDefault()` for every unmodified `;` outside an INPUT/TEXTAREA/contentEditable. It fires before any app handler.
- **Root cause**: Assumes `;` is globally free. Any app-level or library keyboard shortcut bound to `;` (or a custom focusable widget listening for it) is swallowed whenever the dev build is running.
- **Impact**: Silent shortcut breakage during local development; hard to diagnose because it only happens in dev. No prod impact.
- **Fix sketch**: Only `preventDefault` once the mode actually transitions, or require a less collision-prone chord (e.g. `Ctrl+;`) to enter nav mode.

## 4. `isTypingTarget` misses ARIA/rich-text editors and selects
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/app/_dev-inspector/DevInspector.tsx:52-57
- **Scenario**: The typing-target guard excludes only `INPUT`, `TEXTAREA`, and `isContentEditable`. A focused `role="textbox"`/`role="combobox"` custom editor, or a `<select>`, is not excluded, so `;`/`i`/`Esc` are intercepted (and `;` prevent-defaulted) while the user is "typing" there.
- **Root cause**: Enumerates concrete tags instead of the semantic notion of "text entry surface."
- **Impact**: In dev, keystrokes meant for a custom editor arm the inspector or get eaten. Narrow, dev-only.
- **Fix sketch**: Also bail when `el.closest('[role="textbox"],[role="combobox"],[role="searchbox"]')` matches, and treat `SELECT` as a typing target.

## 5. Crumb-row buttons have no hover affordance
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: hover-state
- **File**: src/app/_dev-inspector/devInspectorUi.tsx:96-118
- **Scenario**: `CrumbRow` renders a `<button>` with `cursor:"pointer"` and `className="focus-ring"`, but its `background` only differs for the default row (`isDefault ? ACCENT22 : "transparent"`). Hovering a non-default crumb gives no visual feedback even though it is clickable-to-copy.
- **Root cause**: Inline styles can't express `:hover`, so hover styling was omitted; only keyboard focus and the default-row tint are handled.
- **Impact**: Reduced discoverability/affordance for the "click a row to copy any enclosing file" feature. Cosmetic, dev-only.
- **Fix sketch**: Add a tiny scoped CSS rule (or a small utility class) giving `.crumb-row:hover` a subtle background, matching the existing `ACCENT`-tinted default row.
