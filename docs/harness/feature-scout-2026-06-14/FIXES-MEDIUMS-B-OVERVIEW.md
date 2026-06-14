# Feature Scout Fix — Mediums Wave B · Adaptive org overview (complete: 3/3)

> Personalize the dashboard home: connect goals to the glanced numbers, remember the user's period,
> and let them collapse what they don't need. 3 mediums, all on the org overview surface, no migration.
> Baseline preserved: `tsc` 0; **vitest 456/456**; eslint 0; `next build` ✓ (EXIT 0).

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| OVR #6 — goal-vs-actual tiles | `ba9eb39` | The headline tiles match an active goal by metric (already-fetched `listGoals`) and show "target N · on track / behind / reached" under the delta, coloured by the goal's pace. No new query. |
| OVR #5 — remember-my-period | `724dbcc` | `TimeRangeSelector` writes the chosen window to a year-long `ascent_period` cookie; the overview reads it server-side as the fallback before `DEFAULT_RANGE` — only when no explicit `?range=` is present, so shared URLs stay authoritative. |
| OVR #4 — collapsible overview | `9f970b7` | A `CollapsibleSection` (native `<details>`) wraps the major mid-page grids; collapsed ids persist in a cookie the page reads on the server (no hydration flash). Collapse-only. |

## What was fixed

- **OVR #6 — "are we winning?" at a glance.** The org's stated goals lived in a separate panel; the
  most-glanced tiles (Overall / Adoption / Rigor) didn't say how the number tracks against them. They
  now carry the matching active goal's target + pace verdict — for free, since `listGoals` is already
  fetched on the page.
- **OVR #5 — stop re-picking the period.** Returning users re-chose their window every visit. The last
  choice is remembered in a cookie and used as the default; an explicit `?range=` in a shared link
  still wins (the cookie is consulted only when the param is absent).
- **OVR #4 — tailor the page.** A long overview now collapses per-section, persisted across visits.
  Native `<details>` keeps it working without JS and renders the correct open/closed state on the
  server, so there's no flash of the wrong state on load.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 456/456 (54 files) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 |

## Patterns reinforced

- **Reuse the data already on the page** (OVR #6): the goal-vs-actual read is a match against the
  `listGoals` result the page already fetched — a presentational join, not a new query.
- **Cookie preference, explicit URL wins** (OVR #5): persist the choice in a cookie read server-side
  (SSR matches, shareable), but always let an explicit query param override so links stay authoritative.
- **Native `<details>` for server-friendly collapse** (OVR #4): no client framework, no hydration
  flash — the server reads the cookie and sets `open`, the browser handles the toggle, JS only rewrites
  the cookie. (The `react-hooks/immutability` rule flags `document.cookie =` inside a component-scoped
  handler but not a module-scoped one — keep the cookie writer at module scope to stay lint-clean.)

## What remains (from the INDEX)

Medium waves C–H (planning depth, playbooks/practices, access control, exec/sharing/exports,
CI-gate/metering, live-ops polish) + the 4 lows. Stripe + notifications/email stay excluded.
