# Design System: UI Primitives & Deck — Bug + UI Scan
> Context: Design System: UI Primitives & Deck (Marketing Site & Design System)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. `toneFor` bypasses the noise band that its sibling formatters enforce
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/ui/format.ts:28-31 (contrast :11 `deltaHex`, :37-40 `fmtDelta`, import :4)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: A caller does `DIRECTION_TONE[toneFor(delta)]` to color a movers tile / dimension row. For a `+1` (or `-2`) period delta — statistically scan-to-scan noise per `SCORE_NOISE_BAND = 2` — `toneFor` returns `"rising"`/`"falling"`, so the value is painted the confident lime `▲` "rising" of a real climb. The same delta through `deltaHex`/`fmtDelta` correctly mutes to slate `≈+1`. The two halves of the same exported kit disagree.
- **Root cause**: `toneFor` classifies on sign only (`delta > 0 ? "rising" : delta < 0 ? "falling" : "flat"`) and never calls `isWithinNoise`, even though `deltaHex`/`fmtDelta` (defined right beside it, same import) were specifically built to mute noise so "a re-scan wobble never wears the confident green/orange of a real move." `toneFor` currently has **zero callers** (grep: only the definition + barrel re-exports in `ui/index.ts` and `org/ui.tsx`), so this is a latent trap rather than an active defect — but it is shipped as documented public API.
- **Impact**: Future fleet "which-way" surfaces wired through `toneFor` would silently report noise as real movement — exactly the dishonesty the noise band exists to prevent. Also pure dead-export clutter today.
- **Fix sketch**: Route `toneFor` through `classifyDelta`/`isWithinNoise` so within-noise deltas map to `"flat"` (`return isWithinNoise(delta) ? "flat" : delta > 0 ? "rising" : "falling"`). This makes the whole class impossible: every consumer of `DIRECTION_TONE` via `toneFor` inherits the noise mute. If genuinely unused, delete it instead.

## 2. `SectionHeading` hardcodes `<h2>`, breaking heading order on reuse
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/ui/SectionHeading.tsx:42 (titleCls :32-37)
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: This is *the* canonical section header (marketing decks, org dashboard, in-card `size="sm"` tiles). When used as the first major heading on a page that lacks an `<h1>`, or nested inside a card under an existing `h2`/`h3`, it always emits `<h2>` — producing skipped/non-sequential heading levels for screen-reader and rotor navigation (WCAG 1.3.1 / 2.4.10).
- **Root cause**: The component models visual `size` ("page"/"lg"/"sm") but conflates it with semantic level — the heading tag is fixed to `h2` regardless of document context.
- **Impact**: Systemic, compounding a11y defect across every surface that adopts the primitive; assistive-tech users get a misleading outline.
- **Fix sketch**: Add an optional `as`/`level` prop (`"h1"|"h2"|"h3"|"h4"`, default `h2`) and render the chosen tag; keep `size` purely visual. Decouples appearance from semantics.

## 3. `SideNav` uses `aria-current="page"` on state-based tab buttons
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/ui/SideNav.tsx:51,57 (NavItem)
- **Value**: impact 4 · effort 3 · risk 2
- **Value note**: same `aria-current="page"` is applied to both the route `<Link>` and the in-component `<button>` (report tabs) branch.
- **Scenario**: For the report's in-page tabs (the `onSelect` button branch), a screen reader announces the active tab as "current page" — but selecting it navigates nowhere; it swaps in-component state. `aria-current="page"` is the wrong token for a tab and, more correctly, an in-page tab set should use the tab pattern (`role="tablist"`/`role="tab"`/`aria-selected` + `aria-controls`).
- **Root cause**: One `aria-current="page"` is shared across two semantically different item kinds (route link vs state tab) for code economy.
- **Impact**: Misleading SR semantics on a heavily-reused navigation primitive; "current page" announced for non-navigating controls.
- **Fix sketch**: For the `href` branch keep `aria-current="page"`; for the `onSelect` branch use the tab pattern (or at minimum `aria-current="true"`). Cleanest: wrap the button group in `role="tablist"` and give buttons `role="tab"` + `aria-selected`.

## 4. `DeckNav` correctness silently depends on a referentially-stable `sections` array
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/components/deck/DeckNav.tsx:17-29 (effect dep `[sections]`)
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: A caller writes `<DeckNav sections={[{id:"intro",label:"Intro"}, …]} />` with an inline literal (the natural usage). Every parent re-render produces a new array reference, so the effect re-runs: the `IntersectionObserver` is `disconnect()`ed and rebuilt each render. During rapid re-renders (e.g. a parent with frequent state updates) the active-dot highlight can momentarily drop until the new observer fires.
- **Root cause**: The component offloads the stability contract to the caller — the source comment even warns "Pass a STABLE `sections` array (module-level const)" — but nothing in the type or implementation enforces or tolerates instability.
- **Impact**: Observer churn and transient highlight flicker; an assumption landmine that only bites callers who don't read the comment.
- **Fix sketch**: Depend on a derived stable key instead of the array identity — `const key = sections.map(s => s.id).join("|")` and use `[key]` as the effect dep (re-derive the observed elements inside). Makes the component correct regardless of how the caller passes `sections`.

## 5. `DeckNav` dot labels are hand-rolled and drift from the canonical `Kicker` tracking
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/components/deck/DeckNav.tsx:38-39 (vs src/components/ui/Kicker.tsx:17)
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: The section-dot label is built inline as `font-mono text-xs uppercase tracking-wider text-slate-500` — the exact "hand-rolled mono/uppercase label" the design system exists to consolidate. `Kicker` (the canonical brand label, `tone="muted"`) uses `tracking-[0.22em]`; `tracking-wider` is ~`0.05em`. So the deck's own nav renders a noticeably tighter eyebrow than every Kicker/Dateline label elsewhere on the same page.
- **Root cause**: The deck nav predates / sidesteps the `Kicker` primitive, re-rolling the label treatment instead of composing it — the "one treatment" promise broken inside the design-system context itself.
- **Impact**: Subtle but visible letter-spacing inconsistency between the deck's edge labels and the page's section eyebrows; future rebrands must hunt this literal separately.
- **Fix sketch**: Render the label via `Kicker` (it already accepts `className` for the opacity/transition and active-color states), or at minimum change `tracking-wider` → `tracking-[0.22em]` to match. Keep the active-state `text-accent` override as a className.
