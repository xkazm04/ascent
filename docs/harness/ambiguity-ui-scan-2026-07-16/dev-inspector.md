# Dev Inspector — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. LIBRARY_SEGMENTS substring heuristic silently redirects the default copy target
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/app/_dev-inspector/devLocate.ts:24`
- **Scenario**: The default copy target skips any path where `p.includes(seg)` for the hardcoded segments `/lib/`, `/hooks/`, `/stores/`, `/shared/`, `/ui/`, `/utils/`, `/i18n/`. This is a substring test over the whole path, so a *feature-local* folder — e.g. `src/components/<feature>/hooks/…` or `src/app/<page>/utils/Panel.tsx` — is classified as "library" and the default right-click copies a *parent* file instead of the file you pointed at. Nothing tells the user the innermost entry was skipped (only the subtle purple-dashed vs cyan box distinction), and the list encodes a snapshot of today's repo layout with no note about keeping it in sync (`src/components/` gained many feature subdirs).
- **Root cause**: Path classification by unanchored substring match against a hardcoded, undocumented-maintenance list; no positive marker (e.g. a known shared-roots allowlist) and no HUD signal that the default != innermost.
- **Impact**: Developers paste a `path:line` into Claude Code that points at the wrong file — the exact failure the tool exists to prevent — and it fails silently, eroding trust in every copy.
- **Fix sketch**: Anchor the heuristic to known shared roots (`src/components/ui/`, `src/lib/`, `src/app/_dev-inspector/` …) instead of any-segment substrings; add a one-line comment stating the list must track repo layout; in the HUD, visibly badge the innermost row (e.g. "skipped — library") when `defaultIndex !== 0`.

## 2. Header doc promises "call site" but the default is the innermost non-library file
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/app/_dev-inspector/DevInspector.tsx:12`
- **Scenario**: The usage comment says "Default copy = the call site (the feature/page file that used the component)". `pickDefaultIndex` (`devLocate.ts:66`) actually returns the *first non-library entry from the innermost end* — for a feature component (`src/components/landing/Hero.tsx`) that is the component's own file, not the page that rendered it. The promise only holds when the innermost stamped element happens to be library code.
- **Root cause**: The doc describes the library-skip special case as the general rule; the real rule ("innermost file that isn't classified as shared library code") was never written down.
- **Impact**: Users expecting the page-level call site get a leaf component path (or vice versa) and can't predict which of the two right-click flavors to use; the Alt+right-click distinction becomes guesswork.
- **Fix sketch**: Reword the header (and the HUD footer hint "right-click: call site") to "innermost non-library file"; alternatively make Alt+right-click copy the true parent call site (chain entry after the default) if the call-site semantic is what's wanted.

## 3. Keyboard handling gaps: Esc trapped by focused inputs, `isTypingTarget` misses common editors
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/app/_dev-inspector/DevInspector.tsx:52`
- **Scenario**: (a) While armed, left-clicks intentionally still operate the app — so focusing any `<input>`/`<textarea>` then pressing `Esc` does nothing (`isTypingTarget` returns before the Escape branch at line 119), leaving no keyboard way to disarm until you click elsewhere. (b) `isTypingTarget` only checks `INPUT`/`TEXTAREA`/`isContentEditable`: `<select>`, `role="textbox"` widgets, and shadow-DOM editors (where `e.target` is the host) are missed, so typing `;` there is swallowed by `preventDefault` and toggles nav mode instead.
- **Root cause**: The typing guard is applied uniformly to all keys (including the escape hatch) and enumerates tag names instead of using `event.composedPath()` / a broader editable check.
- **Impact**: A developer stuck in armed mode with focus in a form must reach for the mouse; conversely stray `;` keystrokes in custom editors silently open the inspector — both are confusing interruptions during the exact workflow (form debugging) the tool targets.
- **Fix sketch**: Let `Escape` bypass the `isTypingTarget` guard (exit should always work); extend the guard with `SELECT`, `closest('[contenteditable]')`, and `e.composedPath()[0]` for shadow roots.

## 4. SourceLabel placement constants (22 / 20 / 260) are unexplained and don't bound the chip's width
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/app/_dev-inspector/devInspectorUi.tsx:58-60`
- **Scenario**: `above = rect.top > 22`, `top = rect.top - 20`, `left = min(rect.left, innerWidth - 260)` encode an assumed chip height (~20px) and max width (260px), but the chip itself is `whiteSpace: nowrap` with no `maxWidth` — a long file name like `OrganizationMemberInvitationDialog.tsx:1234` renders wider than 260px and overflows the right viewport edge despite the clamp. The three constants carry no comment linking them to the 11px font metrics they depend on.
- **Root cause**: Layout clamps were tuned empirically against typical file names and hard-coded without documenting the invariant (chip ≤ 260px) or enforcing it in CSS.
- **Impact**: For long file names the one piece of always-visible feedback (which file you're on) is partially unreadable off-screen; future font-size tweaks silently break the vertical offset too.
- **Fix sketch**: Add `maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis"` to the chip so the clamp constant is actually enforced, name the constants (`CHIP_H`, `CHIP_MAX_W`) and derive `top`/`left` from them.

## 5. Copy feedback is visual-only and the HUD blocks inspection of the corner it covers
- **Severity**: Low
- **Category**: a11y
- **File**: `src/app/_dev-inspector/devInspectorUi.tsx:166-198`
- **Scenario**: The "Copied ✓ / Copy failed" status swap is a plain `<div>` — no `role="status"` / `aria-live`, so screen-reader users get no confirmation that right-click did anything. Inspection itself is hover+right-click only (crumb rows are focusable buttons, but you can't reach armed-mode targets by keyboard). Additionally the fixed bottom-left panel (`PANEL`, `left:12, bottom:12, maxWidth:460`) sits over app content, and `insideHud` deliberately ignores events over it — elements underneath are uninspectable with no way to move or collapse the panel.
- **Root cause**: HUD built as pure visual chrome; occlusion/announcement trade-offs weren't addressed (only the hover-affordance case was, at CrumbRow).
- **Impact**: Dev-tool audience narrows (keyboard/AT users excluded from a productivity tool), and anything living bottom-left — commonly toasts, chat launchers, cookie banners — can never be located with the inspector.
- **Fix sketch**: Add `role="status" aria-live="polite"` to the copy-status line; add a small header control (or a keybind, e.g. `h`) that flips the panel to the bottom-right so occluded elements become reachable.
