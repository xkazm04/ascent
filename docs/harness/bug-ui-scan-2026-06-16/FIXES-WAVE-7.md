# Bug-UI Fix Wave 7 — Date / Timezone / Window Math

> 2 atomic commits, 3 findings closed (2 high, 1 medium).
> Baseline preserved: `tsc` 0 → 0 errors · tests 488/488 → 495/495 (+7 new window tests).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `f2bb296` fix(org/window): local-midnight starts + half-open baseline | fleet-rollups #1, #2 | High + Medium | `window.ts` (+test), `db/org-rollup.ts` |
| 2 | `aeabf5a` fix(org): carry the selected time range across all org tabs | org-overview #1 | High | `org/period.ts` (new), 3 org pages |

## What was fixed

1. **Rolling-window starts weren't day-aligned (High).** `30d`/`90d` computed `start` as a raw `N × 86.4M-ms` offset from "right now", while `quarter`/`custom` snapped to local midnight. So the period-over-period baseline was an arbitrary wall-clock instant that flickered within a calendar day and drifted an hour across DST — a boundary-day scan landed on the wrong side of `start` depending on the render hour. Both presets now snap to local midnight (a stable day boundary).
2. **Baseline boundary double-counted (Medium).** The baseline query used `scannedAt: { lte: start }` while the in-window trend uses `gte: start`, so a scan exactly at `start` (clean-midnight seed/snapshot data) counted as both the baseline and the first in-window point — compared against itself for a spurious 0-delta. Now half-open (`lt`).
3. **Selected time range didn't carry across org tabs (High).** Only the Overview tab read the remembered-period cookie; Security/Executive called `resolveWindow(sp)` directly, so a range chosen on Overview reset to the 90d default on navigation. Centralized the precedence (explicit `?range=` > cookie > default) in a server-only `resolveOrgWindow` helper used by all three tabs.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 488/488 | 495/495 |
| New tests | — | +7 (window local-midnight + cookie round-trip) |

## Patterns established (catalogue item 18)

18. **Pick one date reference frame and apply it everywhere.** Mixing fixed-ms offsets with calendar-midnight construction (or UTC truncation with local-midnight) makes "the same day" land differently depending on the hour, the server timezone, and DST. Normalize every window/threshold to one canonical frame (here: local midnight) and use half-open intervals so each instant belongs to exactly one side.

## Deferred this wave (with rationale)

- **`getOrgMovers` silent baseline degrade (fleet-rollups #3, High).** A repo onboarded mid-period falls back to its *first in-window* scan as the baseline, so its lifetime delta is reported as a period delta (inflating "gainers"). The fix is a **semantics call** — exclude such repos from period movers, or surface them as a separate "new this period" group — that changes dashboard composition; deferred for a deliberate decision. **→ semantics call.**
- **Forecast fed the windowed trend (fleet-rollups #4, Medium).** A short display window can collapse the forecast input to 1–2 days and project off noise. The fix decouples the forward-looking forecast from the rear-view window — a behavior change to the trajectory. **→ follow-up.**
- **`daysUntil` UTC frame vs local window frame (fleet-rollups #5 / backlog #3, Medium).** `daysUntil` truncates to UTC while the window layer is local-midnight, so overdue/this-week flips a day for non-UTC viewers. The clean fix needs a **canonical org timezone** — naively switching `daysUntil` to local getters would shift a UTC-midnight-stored `targetDate` back a day on non-UTC servers. Genuine timezone-architecture decision. **→ needs a canonical org timezone.**

## What remains

Remaining waves per INDEX: W8 file-gen/XSS (badge `data:svg`, PDF render 500s, SKILL.md fence) · W9 GitHub resilience · W10 a11y · W11 UI polish.
