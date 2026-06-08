# UI Perfectionist Fix Wave 7 — Polish & microcopy

> 7 commits, 7 findings closed (all Low/Medium polish).
> Baseline preserved: tsc 0 → 0 errors · lint 0 errors/6 warnings → 0 errors/6 warnings · `next build` ✓ compiles.

Mental model: the long tail of finish — transitions, affordance weight, number formatting, hover
feedback, and one-scale-anchor legibility. None are correctness bugs; together they're the
difference between "works" and "feels finished."

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `3547b82` | oauth #3 — distinct expired-state icon | Low | `SignInNotice.tsx` |
| 2 | `ca4fe93` | usage #6 — thousands grouping | Medium | `usage/page.tsx` |
| 3 | `d2005be` | scan-pipeline #8 — error fade-in | Low | `ScanForm.tsx` |
| 4 | `581f242` | onboarding #5 — manage-repos button affordance | Medium | `connect/page.tsx` |
| 5 | `1dc1466` | usage #7 — trend bar hover feedback | Low | `usage/UsageTrend.tsx` |
| 6 | `cc97ad2` | report-trends #5 — DimensionTrends axis label | Medium | `report/DimensionTrends.tsx` |
| 7 | `db44413` | report-trends #8 — trends header chip focus rings | Low | `trends/page.tsx` |

## What was fixed

1. **SignInNotice** expired state gets an hourglass glyph (vs the lock) so the lead icon participates in the state distinction.
2. **Usage numbers** are `toLocaleString()`-formatted in Stat and Bar, so multi-digit totals read as "12,480" on the finance surface.
3. **ScanForm error** eases in with `animate-fade-up` instead of hard-popping and shoving the chip row.
4. **"Manage repositories" recovery link** gets an outline-button treatment (border-accent/40 + padding + hover bg) matching its task importance, instead of faint accent text.
5. **Usage trend bars** get `cursor-help` + a `group-hover` brightness bump, so the chart gives hover feedback instead of feeling inert.
6. **DimensionTrends sparklines** get a faint "65" reference at the L4 threshold, anchoring the otherwise-unlabeled small-multiples to a readable scale.
7. **Trends header links** get the `focus-ring` token so keyboard users can see which header chips are actionable (the static level pill stays rounded-full / non-interactive).

## Verification table

| Gate | Before (Phase B2) | After Wave 7 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | 0 errors / 6 warnings | 0 errors / 6 warnings |
| `next build` | passes | ✓ compiles |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---|---|---|
| 2 | Scoring truth, CVD redundancy & public badge | 7 |
| 1 | Design-token & color-system unification | 6 |
| 3 | Empty / loading / error / done states | 7 |
| 5 | Accessibility: ARIA, keyboard, contrast | 7 |
| 6 | Responsive & mobile layout | 4 |
| 7 | Polish & microcopy | 7 |
| **Total** | | **38 / 45** |

Remaining: **7 findings** — Wave 4 (extraction / DRY): `<Panel>` card primitive, `Tile`/sub-card
radius unify, heatmap → `OrgTable` chrome + a11y, `AiBar` color prop, `StatCard`/`MeterBar`
extraction, `<LevelBadge>`, `ReportShell`. This is the only theme left.

## Patterns established (catalogue items 25–29)

25. **Format numbers for humans** — raw integers on a finance/metrics surface need thousands separators (`toLocaleString`); `tabular-nums` aligns columns but doesn't group digits.
26. **Inert visuals need feedback** — an element with a `title` tooltip but no cursor/hover change reads as non-interactive; add a cursor and a hover treatment so it invites interaction.
27. **Affordance weight should match task importance** — a primary recovery action styled as faint text inverts the visual hierarchy; give important actions a real button affordance.
28. **Small-multiples still need one scale anchor** — a sparkline grid with zero axis labels reads as decoration; a single mid-scale reference makes each chart quantitative.
29. **Match an element's transition to its siblings** — an element that pops in while its peers animate feels unfinished; reuse the app's existing entrance animation.

## What remains

**Wave 4 (extraction / DRY, 7)** is the only open theme per `INDEX.md`. It is consolidation work
(extract shared primitives and route duplicated Card/Tile/Meter/Shell/LevelBadge markup through
them) — note that several of its target files are the ones the concurrent process has been editing,
so a fresh re-read per fix is essential.
