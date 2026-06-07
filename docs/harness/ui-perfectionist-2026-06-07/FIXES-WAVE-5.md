# UI Perfectionist Fix Wave 5 — Tabular rows: extract + readable + focusable

> 2 commits, 5 findings closed (2 high · 2 medium · 1 low). UB#6 (low) deferred again — see below.
> Baseline preserved: tsc 0→0 errors · eslint 0 err/3 warn → 0 err/3 warn · `next build` passes.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `e799432` | OD#1, OD#6, OD#8 | high, high, low | `org/ui.tsx`, `lib/ui.ts`, `…/repositories`, `…/contributors`, `…/delivery` |
| 2 | `9a6b6b8` | CO#4, CO#5 | medium, medium | `onboarding/OnboardingFlow.tsx`, `connect/InstallationRepos.tsx` |

## What was fixed

1. **Shared `OrgTable` (OD#1) + row hover (OD#8).** Four hand-rolled tables (repositories leaderboard, contributors involvement + concentration, delivery governance) duplicated the same chrome and had drifted on `min-width`. They now share one `OrgTable` primitive (scroll wrapper, border radius, header styling, row dividers) that takes `head` + children + `minWidth`, with a subtle built-in row hover so link-bearing rows have an affordance.
2. **Readable heatmap (OD#6).** The repo × dimension heatmap put `opacity` on the whole cell, fading the numeral into illegibility on low-score cells — exactly the weaknesses the heatmap exists to surface. Intensity now rides the fill's **rgba alpha** (not the element opacity), and the numeral color is contrast-picked against the cell's *effective* color over the dark canvas (`heatCell` in `lib/ui.ts`): light text on faint low-score cells, dark ink on bright high-score ones.
3. **Onboarding repo-select focus ring (CO#4).** The repo-select buttons — the most important interaction in onboarding — lacked the `focus-ring` every other control uses. Added it.
4. **Repo-row CTA prominence (CO#5).** The connect repo row packed a watch checkbox, a schedule select, and the filled Scan CTA as equal neighbors. A thin divider now separates the primary Scan action from the secondary controls (hidden on wrap).

## What was deferred (again)

- **UB#6 (low)** — usage `Notice` "View usage docs" affordance + inline `Stat`/`Bar` extraction. The docs affordance is blocked on a docs route that does not exist (won't ship a link to a 404); the `Stat`/`Bar` duplication is purely local to `usage/page.tsx` (cosmetic, no cross-file reuse). Not worth a change without a real docs target. Left as a standing low-priority note.

## Verification (before / after)

| Gate | Before (baseline) | After Wave 5 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors (4-table JSX restructure balanced) |
| `eslint` | 0 errors, 3 warnings | 0 errors, 3 warnings (same pre-existing) |
| `next build` | ✅ pass | ✅ pass |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Cumulative |
|---|---|---:|---:|
| 1 | Design-token unification | 7 | 7 / 40 |
| 2 | Notice / EmptyState consolidation | 5 | 12 / 40 |
| 3 | Chart & badge data-viz language | 7 | 19 / 40 |
| 4 | Cross-page funnel & dashboard layout | 4 | 23 / 40 |
| 5 | Tabular rows: extract + readable + focusable | 5 | 28 / 40 |

Remaining: **12** — Wave 6 (landing: SP#1, SP#5, SP#6, SP#7, SP#8), Wave 7 (trends/a11y: RT#4, RT#5, RT#8, CO#7), carried OD#4 + OD#7, deferred UB#6.

## Patterns established (catalogue items 13–14)

13. **Extract the chrome, parameterize the content** — N tables that share a wrapper/header/divider but differ in columns become one `OrgTable(head, children, minWidth)`. The shared shell carries cross-cutting affordances (row hover) for free, in one place, and kills min-width drift.
14. **Intensity belongs on the fill's alpha, not the element's `opacity`** — `opacity` on a cell fades its text too. Encode a heat/intensity ramp in an rgba alpha and contrast-pick the foreground against the *effective* (blended) color, so the value stays readable at every intensity.

## What remains

- **Wave 6** — Landing cohesion & correctness (SP#1 dimension-count contradiction, SP#5 chip feedback, SP#6 mobile autofocus, SP#7 empty-gallery notice, SP#8 hero entrance polish).
- **Wave 7** — Trends/report finishing & a11y (RT#4 /trends loading, RT#5 aria labels, RT#8 responsive radar, CO#7 scan-progress %).
- **Carried** — OD#4, OD#7 (org-tab shell pass). **Deferred** — UB#6.
