# UI Perfectionist Fix Wave 3 — Empty / loading / error / done states

> 7 commits, 7 findings closed (1 High + 6 Medium).
> Baseline preserved: tsc 0 → 0 errors · lint 0 errors/6 warnings → 0 errors/6 warnings · `next build` ✓ compiles.

Mental model: every surface needs idle / empty / error / done coverage. The app already ships an
`EmptyState` primitive — these are the call sites that skipped it, swallowed failures, or left a
terminal state looking like the in-progress one.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `d9a3e93` | oauth #2 — state-aware SignInNotice body | Medium | `SignInNotice.tsx` |
| 2 | `8edc250` | org-dashboard #8 — disabled scan-button explanation | Medium | `OrgScanButton.tsx` |
| 3 | `2734a65` | usage #2 — new-org empty state | High | `usage/page.tsx` |
| 4 | `a6a190e` | org-dashboard #6 — `InlineEmpty` primitive | Medium | `org/ui.tsx`, `org/[slug]/page.tsx` |
| 5 | `27e7d28` | scan-pipeline #6 — hero chip provenance label | Medium | `ScanForm.tsx` |
| 6 | `74fe591` | onboarding #6 — scan-complete success affordance | Medium | `OnboardingFlow.tsx` |
| 7 | `63a8f5f` | report-trends #9 — failed history fetch ≠ baseline | Medium | `ReportView.tsx` |

## What was fixed

1. **SignInNotice** body is now state-aware — re-authenticate copy in the expired state, connect copy for first-time — instead of unconditional onboarding language stacked under the "you were signed out" alert.
2. **OrgScanButton** empty-fleet (`watchedCount === 0`) state now explains the disabled CTA via a `title` and a helper link to `/connect`, instead of a dead-end greyed-out button.
3. **Usage page** for a reachable DB with zero scans renders the canonical `EmptyState` ("No scans metered yet" + a primary "Scan a repo" action) instead of a dashboard of four 0 stats and two empty bars.
4. **InlineEmpty** primitive added — the org overview's in-card empties (movers, benchmark, common-gaps, outliers) route through one muted-line treatment instead of three `<p>`s + one `<div>` that had drifted.
5. **Hero chips** are labelled by provenance — "Top scored:" when they're live gallery repos, "Try:" for the static fallback — so the fallback can't masquerade as trending data.
6. **Onboarding scan-complete** gets a status badge (emerald ✓ when all passed, amber ! when some errored) and an error count in the subhead, so the activation moment reads as a win and partial-failure is distinct from full success.
7. **Report history fetch** sets a `histError` flag in its previously-empty catch; the trend panel now shows "Couldn't load history — showing this scan only" on a transient/offline failure, distinct from the legit "Baseline established" single-scan copy.

## Verification table

| Gate | Before (Phase B2) | After Wave 3 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | 0 errors / 6 warnings | 0 errors / 6 warnings |
| `next build` | passes | ✓ compiles |

Each fix was type-checked before commit; the 6 warnings are pre-existing and untouched.

## Deferred (noted, not done this wave)

- **Report history retry button** (report #9) — a true refetch control was left out to avoid threading retry state through a 1000-line, concurrently-edited component. The core bug (error indistinguishable from baseline) is fixed via the distinct message; a retry is a follow-up.
- **Hero chip skeleton/min-height** (scan #6) — not needed: the example chips are server-resolved (the RSC awaits the gallery), so there is no client loading flash to reserve space for. Only the provenance label was actionable.

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---|---|---|
| 2 | Scoring truth, CVD redundancy & public badge | 7 |
| 1 | Design-token & color-system unification | 6 |
| 3 | Empty / loading / error / done states | 7 |
| **Total** | | **20 / 45** |

Remaining: **25 findings** across Wave 4 (extraction/DRY, 7), Wave 5 (a11y ARIA/keyboard/contrast, 7), Wave 6 (responsive, 4), Wave 7 (polish, 7).

## Patterns established (catalogue items 10–14)

10. **Distinguish "empty" from "failed"** — a fetch that swallows errors in an empty catch makes "no data yet" and "couldn't load" render identically. Track an error flag and surface the failure distinctly, so a transient blip never masquerades as a clean empty/baseline.
11. **Terminal states deserve a visible affordance** — a "done" state that only swaps header text reads like the in-progress state minus motion. Give completion a distinct marker (success glyph/badge) and differentiate all-passed vs partial-failure.
12. **One primitive per empty scale** — page (`EmptyState variant=page`), section (`variant=section`), and now in-card (`InlineEmpty`). Scattered ad-hoc "nothing here" lines drift; route each scale through its named primitive.
13. **Label data by provenance** — when a UI silently falls back from live data to static defaults, label the source ("Top scored:" vs "Try:") so the fallback doesn't read as live/trending data.
14. **Reachable-but-empty is an onboarding moment, not a zero dashboard** — a configured backend with no data yet should render an EmptyState with a next action, not a grid of zeros that looks like a populated page that happens to be empty.

## What remains

Four themed waves open per `INDEX.md`. **Wave 5 (accessibility)** is the most correctness-flavoured
remaining batch (skip link, `aria-current`, `aria-invalid`/focus, `progressbar` roles, table scope,
contrast); **Wave 4 (extraction/DRY)** consolidates the remaining duplicated Card/Tile/Shell/LevelBadge
markup.
