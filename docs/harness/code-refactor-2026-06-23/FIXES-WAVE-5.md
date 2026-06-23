# Code Refactor — Fix Wave 5: UI shared constants & chips (COMPLETE)

> 7 commits, 7 findings closed. Baseline: tsc 0→0 · tests 2610 (unchanged; no tests
> added/modified). Two intentional visual drift-corrections (noted below).

| # | Commit | Finding | What was consolidated |
|---|---|---|---|
| 1 | `refactor(report): import shared STATUS_LABEL/STATUS_ACCENT in trackers` (`e553c05`) | backlog #1 | RecommendationTracker + InitiativesPanel import the canonical maps from `backlogShared.ts`. |
| 2 | `refactor(org): single-source POSTURE_ORDER from org/ui` (`bd7306e`) | live-war-room #1 | Deleted the `liveWarRoomShared` duplicate; re-export the canonical from `org/ui.tsx`. |
| 3 | `refactor(connect): reuse SCHEDULES constant in bulk cadence picker` (`5189d6e`) | connect-repo #1 | InstallationRepos bulk `<select>` maps the imported `SCHEDULES` instead of an inline literal. |
| 4 | `refactor(org): single-source the direction-tone arrow+color triad` (`0f1c7a3`) | org-overview #1 | `DIRECTION_TONE` + `toneFor` in `components/ui/format.ts`; routed Trajectory, org-page MoversList, PortfolioTable, executive MoveRow through it. |
| 5 | `refactor(report): use shared DeltaTag in DimensionTrends card` (`f62a7ac`) | trends-comparison #1 | Inline delta chip → `<DeltaTag delta hideZero />`. **Visual correction:** restored `tabular-nums` the inline copy dropped. |
| 6 | `refactor(ui): compose Kicker(muted) in Dateline and Stat eyebrows` (`26a8fce`) | design-system #1 | Dateline + Stat compose `Kicker tone="muted"`. **Visual correction:** Stat's label tracking `0.2em → 0.22em` (canonical). |
| 7 | `refactor(org): import shared humanizeDays in Simulator` (`28a1dda`) | investment-sim #1 | Deleted Simulator's byte-identical copy; imports the shared `humanizeDays`. |

## Left un-unified (with reason)

- **goalView's `INIT_STATUS_LABEL`** (#1) — a genuinely divergent lowercased display variant ("in progress"/"done"), not equivalent to the canonical map.
- **`DeckNav` eyebrow** (#6) — its per-state accent/slate color toggle + `tracking-wider` can't route through the 2-tone `Kicker` without a visible change.
