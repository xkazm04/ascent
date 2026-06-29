# Landing Page Prototypes — Bug + UI Scan
> Context: Landing Page Prototypes (Marketing Site & Design System)
> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

Scope note: despite the "prototypes" folder name, `IndexLanding` is wired as the **live homepage** (`src/app/page.tsx:2,85`), so every finding below affects production marketing/conversion, not a throwaway A/B variant. Context-map drift: the dispatch lists `index/EditorialSteps.tsx` (deleted — no longer exists) and omits the two sections that are actually rendered, `index/IndexOrg.tsx` and `index/ScanModal.tsx`.

## 1. Mandatory scroll-snap strands the bottom of content-heavy sections
- **Lens**: ui-perfectionist
- **Severity**: high
- **Category**: responsiveness
- **File**: src/app/globals.css:57,65 (`scroll-snap-type: y mandatory` + `scroll-snap-stop: always`); src/components/landing/prototypes/index/IndexGallery.tsx:40, PricingCards.tsx:13, DimensionMatrix.tsx:41, IndexOrg.tsx:52 (each `min-h-screen snap-start flex flex-col justify-center`)
- **Value**: impact 7 · effort 4 · risk 3
- **Scenario**: On a phone, a zoomed window, or a short laptop, several deck sections exceed 100vh: the live register (IndexGallery — 10+ rows + header + footer CTA), the Pricing tiers (stacked to one column on mobile = 3 tall cards + heading + paragraph), the 9-row DimensionMatrix table, and IndexOrg's 6 cards. The deck applies `scroll-snap-type: y mandatory` with `scroll-snap-stop: always` on every `section[id]`. A user lands at a tall section's top (snap-start); the next scroll gesture is forced to the *next* section's snap point, skipping the un-viewed bottom of the current one. `justify-center` makes it worse by pushing the first/last rows away from the snap edge.
- **Root cause**: Sections assume "one screen of content fits one viewport"; `justify-center` + mandatory snap + always-stop only holds when content ≤ viewport.
- **Impact**: Core conversion content is partially unreachable on mobile — e.g. the Enterprise pricing card / its note, or the lowest register rows — so the page silently hides pricing and social proof from a large segment.
- **Fix sketch**: For sections that can overflow, use `justify-start` (gate `lg:justify-center`) so content begins at the snap edge, and/or switch those sections to `scroll-snap-align`/proximity instead of `scroll-snap-stop: always` so a long section scrolls naturally before the next snap engages.

## 2. Scan dialog has no focus containment
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/landing/prototypes/index/ScanModal.tsx:64-76,90-164
- **Value**: impact 6 · effort 4 · risk 2
- **Scenario**: Opening the primary "Scan a repository" dialog autofocuses the ScanForm input (good) and traps Escape + locks scroll + returns focus on close (good). But Tabbing past the last control (the GitHub `AuthCta`) moves focus out of the dialog into the hero links/CTA behind it — the rest of the page is never set `inert`/`aria-hidden`. A sighted keyboard user ends up interacting with obscured background controls while a `aria-modal="true"` dialog is open.
- **Root cause**: `aria-modal="true"` makes the modal correct for screen readers, but there's no programmatic Tab trap or background `inert` for sighted keyboard navigation.
- **Impact**: Confusing, partially inaccessible keyboard flow on the homepage's main call-to-action (WCAG 2.4.3 Focus Order).
- **Fix sketch**: Cycle Tab/Shift+Tab between the first and last focusable elements inside the dialog, and apply `inert` (or `aria-hidden`) to the page root while `open`.

## 3. Decorative hero backdrop marked `priority`, competing with LCP
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/landing/prototypes/index/IndexHero.tsx:26-28
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: The hero backdrop `<Image src="/brand/proto/index-bg.png" fill priority sizes="100vw" className="object-cover object-right opacity-40">` is purely decorative — `alt=""` inside an `aria-hidden` wrapper, rendered at 40% opacity. `priority` injects a high-`fetchpriority` preload for a full-bleed editorial PNG, so on slow/mobile connections the browser races a barely-visible background against the genuinely critical resources (the H1/CTA text and web fonts that form the real LCP).
- **Root cause**: `priority` (meant for the actual LCP image) applied to a background that is not the LCP element.
- **Impact**: Slower first meaningful paint of the production hero where it counts most (3G/mobile), for an image users barely perceive.
- **Fix sketch**: Drop `priority` (let it load at default priority) — the text hero is the LCP and shouldn't wait on a 40%-opacity backdrop.

## 4. Dimension bars are normalized to the heaviest cell but labeled with the raw weight
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/components/landing/prototypes/index/DimensionMatrix.tsx:15-34; src/components/landing/prototypes/shared/matrixData.ts:44-56
- **Value**: impact 4 · effort 3 · risk 2
- **Scenario**: `CellBar` draws width `= w / MAX_WEIGHT` (relative to the single heaviest cell) but prints the absolute percent `pct(w)` next to it. The heaviest dimension (e.g. 20%) therefore renders a *full-track* bar captioned "20%" — a bar that visually reads as 100% is labeled 20%, and a 10% bar is half-length, implying the longest bar is twice the value when it's actually 2×, fine, but the full bar ≠ "100%" mismatch reads as a defect. The intro ("longer bars carry more weight") explains the ordering but not the bar-vs-number scale gap.
- **Root cause**: Two different encodings on the same row — bar length = relative intensity, number = absolute weight.
- **Impact**: Mild misreading of the rubric's weighting "instrument" on the homepage.
- **Fix sketch**: Scale bars against a fixed 0–25% track (so length matches the printed percent), or add a small "relative to heaviest" caption beside the bar column to make the normalization explicit.

## 5. Dimension descriptions are reachable only via native `title` hover
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/landing/prototypes/index/DimensionMatrix.tsx:73 (`<td title={r.description}>`)
- **Value**: impact 4 · effort 3 · risk 1
- **Scenario**: Each dimension's explanatory `description` is exposed only through the `title` attribute on its `<td>` cells. Touch users get no tooltip, keyboard users can't trigger it, and screen-reader support for `title` is inconsistent — so the "what this dimension means" content of the instrument section is invisible to every non-mouse visitor of the homepage.
- **Root cause**: `title` used as the sole carrier of meaningful (non-redundant) content.
- **Impact**: Explanatory content gap for mobile/keyboard/SR users on a key marketing section.
- **Fix sketch**: Surface the description as visible or disclosure-expandable text, or as a real accessible tooltip wired with `aria-describedby` and focus support; keep `title` only as a redundant enhancement. (The axis dot `title` at line 67 is already covered by the visible legend at lines 83-86, so that one is just redundant.)
