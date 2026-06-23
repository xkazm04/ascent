# Code Refactor — Fix Wave 6: UI shared components & markup (COMPLETE)

> 7 commits, 8 findings closed. Baseline: tsc 0→0 · tests 2610 (unchanged).

| # | Commit | Finding | What was extracted |
|---|---|---|---|
| 1 | `refactor(og): extract shared OG brand chrome into src/lib/og` (`e070a0f`) | app-shell #1 | `src/lib/og/og-brand.tsx` (SHELL, `Brand()`, palette, `OG_SIZE`/`OG_CONTENT_TYPE`); all 4 OG routes routed through it. **Canonical = org/report copy** (44px tile, 28px wordmark, letterSpacing 9); root/launch shift a few px to canonical. |
| 2 | `refactor(org): extract ScopeFilterBar …` (`79becb2`) | people-analytics #1 | `ScopeFilterBar` (gate + children slot); migrated contributors/teams/delivery. (7 sibling tabs left un-migrated — optional.) |
| 3 | `refactor(auth): share GitHub sign-in button chrome` (`337e9af`) | github-oauth #1 | `src/components/auth/buttonChrome.tsx` (GitHubMark, Spinner, SIGN_IN_VARIANTS); both buttons import it. Each keeps the correct `disabled` vs `aria-disabled` for its element. |
| 4 | `refactor(org): share briefing DimRow + prev-period grid …` (`7aa2683`) | executive-briefing #1 + #2 | `src/components/org/briefingShared.tsx` (DimRow + PriorPeriodGrid) on exec + share pages. **Drift corrected:** share-page deltas now route through canonical `deltaHex`/`fmtDelta`. |
| 5 | `refactor(live): share toLiveRepoSeeds rollup→seed mapper` (`0ef5cd8`) | live-war-room #2 | `toLiveRepoSeeds()` in `liveWarRoomShared.ts`; both live pages use it. |
| 6 | `refactor(about): share Remotion Metric + mono/clamp01 …` (`e4f01c8`) | marketing-about #1 | `src/components/about/compositionShared.tsx` (`MONO`/`clamp01`/`Metric`); both compositions import it. |
| 7 | `refactor(org): extract bulkTagRepos client helper` (`37d7764`) | repositories-segments #1 | `bulkTagRepos()` in `src/lib/org/segment-actions.ts`; both callers use it, keeping their own optimistic state. |

## Note

- **OG (#1)**: canonical tile/wordmark chosen from the org+report copy; the root and launch cards shift a few px — acceptable for non-critical social-card assets.
- **ScopeFilterBar (#2)**: the report's "teams renders an empty wrapper" drift was already stale (current teams code gates) — preserved.
