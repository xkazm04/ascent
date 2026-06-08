# UI Perfectionist Fix Wave 5 — Accessibility: ARIA, keyboard, contrast

> 7 commits, 7 findings closed (2 High + 5 Medium).
> Baseline preserved: tsc 0 → 0 errors · lint 0 errors/6 warnings → 0 errors/6 warnings · `next build` ✓ compiles.

Mental model: non-color, non-visual accessibility — keyboard bypass, semantic active/role state, the
input↔error wiring, and contrast/legibility floors. The cues exist visually; this wave makes them
available to assistive tech and keyboard users.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `546fc18` | scan-pipeline #2 — skip-to-content link | High | `layout.tsx`, `page.tsx`, `org/[slug]/layout.tsx` |
| 2 | `594cdfe` | org-dashboard #2 — OrgNav aria-current + overflow cue | High | `OrgNav.tsx` |
| 3 | `3fa225f` | scan-pipeline #3 — disabled button contrast | Medium | `ScanForm.tsx` |
| 4 | `64f06be` | scan-pipeline #7 — hero microcopy semantics | Low | `page.tsx` |
| 5 | `85ab79c` | onboarding #7 — error aria-invalid/focus | Medium | `OnboardingFlow.tsx` |
| 6 | `fe9ac1c` | report-trends #6 — contributor bar progressbar role | Medium | `ReportView.tsx` |
| 7 | `a6ac91b` | report-trends #7 — illegible 7px SVG legend | Medium | `ReportView.tsx` |

## What was fixed

1. **Skip link** — a visually-hidden-until-focused "Skip to content" link is now the first focusable element (root layout), targeting `#main`; the landing main and the org shell main (wrapping all 11 org routes) carry that id. Keyboard/SR users can bypass the sticky header (WCAG 2.4.1).
2. **OrgNav** — `aria-current="page"` on the active tab (was color-only, invisible to SRs) + a mobile right-edge fade cueing that the 11-tab row scrolls.
3. **Disabled Scan button** — `disabled:opacity-50` (which faded the label under AA in the common resting state) replaced with an explicit `disabled:bg-slate-800 disabled:text-slate-400` skin.
4. **Hero microcopy** — the middot-joined trust line is split into per-claim spans with `aria-hidden` separators, so SRs read three distinct benefits instead of one run with vocalized middots.
5. **Onboarding error** — the org input is wired to its error via `aria-invalid` + `aria-describedby`, and focus returns to the field when an error appears (was a sibling `role=alert` with no programmatic link and no focus management).
6. **Contributor AI-share bar** — `role="progressbar"` + `aria-valuenow/min/max` + a contributor-named `aria-label` (the bar was silent to SRs).
7. **ProvenanceTrack legend** — the sub-legible 7px corner legend removed; values remain in the svg `aria-label`, per-element `<title>` tooltips, and the tick/marker positions.

## Verification table

| Gate | Before (Phase B2) | After Wave 5 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | 0 errors / 6 warnings | 0 errors / 6 warnings |
| `next build` | passes | ✓ compiles |

## Deferred (noted, not done this wave)

- **id="main" on the remaining route shells** (scan #2) — the skip link works on the landing page and every `/org/*` route now; usage / report / trends / connect / onboarding / launch / badge / compare each define their own `<main>` and can adopt `id="main"` in a trivial follow-up for full app-wide coverage.
- **9–11px chart axis text** (report #7) — the egregious 7px legend is removed; the 9px TrendChart / 11px radar axis labels are borderline (≥9px) and left as-is to avoid re-touching concurrently-edited chart files for marginal gain.

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---|---|---|
| 2 | Scoring truth, CVD redundancy & public badge | 7 |
| 1 | Design-token & color-system unification | 6 |
| 3 | Empty / loading / error / done states | 7 |
| 5 | Accessibility: ARIA, keyboard, contrast | 7 |
| **Total** | | **27 / 45** |

Remaining: **18 findings** across Wave 4 (extraction/DRY, 7), Wave 6 (responsive, 4), Wave 7 (polish, 7).

## Patterns established (catalogue items 15–20)

15. **A skip link needs a landmark** — a bypass-blocks link is only as good as the `id="main"` (or `<main>`) target on each route; a global skip link with no target on a page is itself an a11y smell.
16. **Active state needs a semantic, not just a color** — a tab/nav active state conveyed only by color/border is invisible to SRs; add `aria-current="page"` (the route IS the tab, so tablist semantics would be wrong).
17. **Disabled ≠ faded** — `opacity-50` fades fill *and* text together, dropping the label under AA; use an explicit disabled skin (distinct bg + still-legible text).
18. **A value-bearing bar is a progressbar** — a fill-width bar needs `role="progressbar"` + `aria-valuenow/min/max` + a label, not just adjacent text.
19. **Wire errors to their field** — an error needs `aria-describedby` from the input + `aria-invalid` + focus return, not just a sibling `role="alert"`.
20. **Don't shrink text to fit — drop it** — when a value can't be drawn at a legible size in a tight space, rely on the accessible name / tooltip rather than sub-legible micro-text; decorative separators get `aria-hidden`.

## What remains

Three themed waves open per `INDEX.md`: **Wave 4 (extraction/DRY, 7)** consolidates duplicated
Card/Tile/StatCard/MeterBar/LevelBadge/ReportShell markup; **Wave 6 (responsive, 4)** fixes the
sticky-offset / width-cap / mobile-visibility bugs; **Wave 7 (polish, 7)** is the finish tail.
