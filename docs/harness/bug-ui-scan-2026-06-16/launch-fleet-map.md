# Launch Fleet Map — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 7

## 1. Interactive star links are invisible to screen readers (`role="img"` swallows the subtree)
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: Accessibility (a11y / keyboard + screen reader)
- **File**: src/components/launch/ConstellationField.tsx:86
- **Scenario**: A keyboard/screen-reader user lands on the Mission Control map and wants to open a repo's report. Every repo star is wrapped in `<a href={reportPermalink(...)} aria-label={…}>`, which the author clearly intended to be a reachable, labelled link.
- **Root cause**: The parent `<svg … role="img" aria-label={`${c.login} constellation`}>` declares the whole SVG an atomic image. Per ARIA, `role="img"` makes the element's entire subtree presentational — assistive tech collapses it to a single image node and does **not** expose descendant `<a>` links or their `aria-label`/`<title>`. So all per-star labels (`Open report for …`) are dead, and the map's core "a star is a repo report link" affordance is unreachable without a mouse. (Keyboard focus may still tab through the `<a>`s in some engines, but the announced name/role is unreliable and the field is announced as one image.)
- **Impact**: The primary interaction of the cinematic entrance is inaccessible to non-pointer users on the page the OAuth callback deliberately lands on — a WCAG 2.1 SC 1.3.1 / 4.1.2 failure and a navigational dead end.
- **Fix sketch**: Drop `role="img"` from the interactive `<svg>` (or split: a decorative `aria-hidden` SVG layer for lines/glow + the star links exposed in the normal a11y tree). Keep the per-org label as a visually-hidden heading or `aria-labelledby` on a group, not as `role="img"` on the link-bearing SVG. Verify each star link is announced as "link, Open report for owner/repo · L3 78".

## 2. Star tap targets are ~15px on mobile — far below the minimum touch size
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: Mobile / responsiveness / touch ergonomics
- **File**: src/components/launch/ConstellationField.tsx:145
- **Scenario**: On a phone (`sm` grid is single-column, card ≈ full width), a user taps a star to open its report. Adjacent phyllotaxis stars sit a few SVG units apart and the inner repo stars cluster near radius ~13–25.
- **Root cause**: The transparent hit halo is `r = Math.max(look.r + 1.4, 3)` in a `120×120` viewBox. Even at a generous ~340px rendered card that is `3 / 120 * 340 ≈ 8.5px` radius → ~17px diameter — under the WCAG 2.2 SC 2.5.8 (24px) and platform (~44px) targets. Densely-packed inner stars overlap hit areas, so taps land on the wrong repo or miss entirely. No `touch-action`/spacing compensation for small screens.
- **Impact**: The headline "tap a star" interaction is frustrating-to-unusable on mobile — the exact post-sign-in surface where a new user first explores their fleet.
- **Fix sketch**: Enlarge the transparent hit circle substantially (e.g. `Math.max(look.r + 4, 6)`), and/or render a larger invisible tap layer on coarse pointers (`@media (pointer: coarse)`). Consider a tap-to-reveal label/tooltip on touch since `<title>` hover does nothing on touch devices.

## 3. Loading skeleton conveys "loading" only via animation — gone under reduced motion
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: Loading states / prefers-reduced-motion
- **File**: src/components/launch/ConstellationField.tsx:109
- **Scenario**: A `prefers-reduced-motion: reduce` user opens the map while an org is still `loading`. The skeleton stars are meant to read as a pending placeholder.
- **Root cause**: Skeleton stars are plain `.launch-star` faint circles whose only "I'm a placeholder" signal is the `ascent-twinkle` animation + staggered `animationDelay`. `globals.css:295` correctly disables `.launch-star`/`.launch-glow` animation under reduced motion (good — this is *not* a missing-guard bug), but as a side effect the skeletons become static dim dots indistinguishable from real "not scanned" stars, with no shimmer/pulse to mark them as loading. There is a textual "charting…" status, but the field itself gives a false "sparse real fleet" impression.
- **Impact**: Reduced-motion users (a meaningful accessibility cohort) get a degraded, ambiguous loading state on the entrance screen — they can't tell "still loading" from "empty org".
- **Fix sketch**: Give skeletons a motion-independent placeholder treatment — e.g. a dashed/hollow ring, lower fixed opacity with a `aria-busy`/visually distinct color, or a single non-looping shimmer that still reads when static. Keep the existing animated version under `no-preference`.

## 4. State updates after unmount in scan + hydration fetches (no mounted/abort guard around setState)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: State on unmount / async cleanup
- **File**: src/components/launch/FleetMap.tsx:100
- **Scenario**: A user clicks "Scan", then immediately navigates away (or the org card unmounts). The in-flight `scanOrg` is aborted via `scanCtrl.current?.abort()` (line 57), which makes `readSSE` throw into the `catch`, and the `finally` then runs `setScanning(...)` on the unmounted tree. The initial hydration effect (line 111) has the same shape: `.then(...)` calls `setConstellations` with no aborted/cancelled check — only the `.catch` branch guards on `controller.signal.aborted` (line 122).
- **Root cause**: `scanOrg`'s `finally` (line 99–100) and the hydration `.then` (line 111) call setState unconditionally. Abort rejects the *fetch*, but if the response arrived before unmount, `await res.json()` / SSE callbacks can still resolve and set state on a gone component. The 90s refresh effect, by contrast, *does* use a `cancelled` flag correctly (line 149) — these two earlier paths were not given the same guard.
- **Impact**: Low in React 18+ (the dev warning was removed and the no-op is harmless), but it is a latent inconsistency and a real "set state after unmount" path that can mask logic errors and waste a render. Cheap to make uniform.
- **Fix sketch**: Mirror the refresh effect: track a `cancelled`/mounted ref and early-return before each `setConstellations`/`setScanning` in `scanOrg` and the hydration `.then`; in the hydration effect read `controller.signal.aborted` before setting state in `.then` too.

## 5. Constellation lines & faint stars sit below perceptible contrast on the dark field
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Color / contrast / visual hierarchy
- **File**: src/components/launch/ConstellationField.tsx:103
- **Scenario**: A user with average displays/eyesight (or in a bright room) looks at a mostly-unscanned org. Constellation lines render at `opacity={0.12 + (overall/100)*0.28}` (so 0.12–0.40), and unscanned stars at `FAINT #64748b` × `opacity 0.32` (`fleetMapStars.ts:59`).
- **Root cause**: Slate-500 at ~32% over the near-black `launch-sky` canvas yields an effective luminance contrast well under 3:1 — the "connective tissue" of the constellation (the lines) and every not-yet-scanned repo are effectively invisible, so the central metaphor ("a web of repos around each org core") doesn't read until repos are scanned. `scoreHex` deliberately keeps *foreground numerals* AA-compliant, but these decorative-but-meaningful marks were never held to a visibility floor.
- **Impact**: Weak visual hierarchy / discoverability — the map looks emptier and less "connected" than it is; unscanned repos (the ones a user should go scan) are the hardest to see.
- **Fix sketch**: Raise the line-opacity floor (e.g. `0.18 + …`) and lighten/raise the unscanned-star floor (e.g. `FAINT` → a lighter slate or `opacity ≥ 0.45`), or give unscanned stars a thin stroke so they hold a minimum presence. Re-check against the spotlight wash so bright-center stars don't blow out.
