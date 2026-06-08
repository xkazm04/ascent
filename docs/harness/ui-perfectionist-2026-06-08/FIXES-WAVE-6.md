# UI Perfectionist Fix Wave 6 — Responsive & mobile layout

> 4 commits, 4 findings closed (1 High + 2 Medium + 1 Low).
> Baseline preserved: tsc 0 → 0 errors · lint 0 errors/6 warnings → 0 errors/6 warnings · `next build` ✓ compiles.

Mental model: viewport-driven layout — sticky offsets, width caps, and what's hidden on mobile.
Best fixed together against the small-screen + sticky-header profile.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `5abc349` | oauth #1 — expired-session alert width cap | High | `SignInNotice.tsx` |
| 2 | `6dd3f9b` | onboarding #4 — sticky select-bar header offset | High | `OnboardingFlow.tsx` |
| 3 | `6c4c6e3` | scan-pipeline #4 — mobile prefix cue | Medium | `ScanForm.tsx` |
| 4 | `6c690e7` | org-dashboard #9 — header stats on mobile | Low | `org/[slug]/layout.tsx` |

## What was fixed

1. **Expired-session alert** gets `max-w-md` to match the body, so the long banner no longer stretches past the centered column on wide viewports.
2. **Onboarding sticky bar** — verified SiteHeader IS sticky (`top-0 z-30`); the select-bar was `sticky top-0 z-10` and slid under it. Offset to `top-16` (just below the ~57px header) so the bulk-select controls pin beneath the nav instead of behind it.
3. **ScanForm mobile** gets a persistent `sm:hidden` "github.com/owner/repo" helper line, since the prefix is hidden below `sm` and the placeholder vanishes on first keystroke.
4. **Org header stats** ("X/Y scanned · N watched") no longer `hidden sm:inline` — the header row is already `flex-wrap`, so the stats wrap to a second line on mobile instead of vanishing.

## Verification table

| Gate | Before (Phase B2) | After Wave 6 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | 0 errors / 6 warnings | 0 errors / 6 warnings |
| `next build` | passes | ✓ compiles |

The onboarding sticky-offset fix was preceded by verifying SiteHeader's positioning (Brand.tsx:37,
`sticky top-0 z-30`, ~57px tall via `py-3.5`) rather than assuming — per the finding's own caveat.

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---|---|---|
| 2 | Scoring truth, CVD redundancy & public badge | 7 |
| 1 | Design-token & color-system unification | 6 |
| 3 | Empty / loading / error / done states | 7 |
| 5 | Accessibility: ARIA, keyboard, contrast | 7 |
| 6 | Responsive & mobile layout | 4 |
| **Total** | | **31 / 45** |

Remaining: **14 findings** across Wave 4 (extraction/DRY, 7) and Wave 7 (polish, 7).

## Patterns established (catalogue items 21–24)

21. **Sticky offsets must account for other sticky elements** — a `sticky top-0` under a `sticky top-0` header collides (and z-index just decides which one wins the overlap). Offset to the header's height — and verify the header is actually sticky before assuming a collision exists.
22. **Don't hide context on mobile without a fallback** — `hidden sm:inline` that drops information on phones needs a wrap or condensed alternative. When the parent is already `flex-wrap`, just removing the hide lets it wrap.
23. **A width-capped column needs every stacked element capped** — an injected element (an alert in a slot) without the body's `max-w` breaks the centered column on wide viewports; cap each stacked child to the same measure.
24. **A field's only persistent affordance can't be viewport-conditional** — if a prefix/label is the field's standing hint, hiding it on mobile needs a replacement cue, or the field loses its affordance exactly where messy input is most likely.

## What remains

Two themed waves open per `INDEX.md`: **Wave 4 (extraction/DRY, 7)** — extract Panel/Tile/StatCard/
MeterBar/LevelBadge/ReportShell and route duplicated markup through them; **Wave 7 (polish, 7)** —
the finish tail (transitions, affordance differentiation, number formatting, chart hover/labels).
