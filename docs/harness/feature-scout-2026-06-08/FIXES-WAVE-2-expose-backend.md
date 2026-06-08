# Feature Scout Fix Wave 2 — Expose the dormant backend

> 6 findings closed in 6 atomic commits (+1 docs commit for the scan).
> Theme: capabilities that were fully built on the backend but had no UI / route / config to reach them.
> Baseline preserved: tsc 0 → 0 errors · eslint 0 errors (pre-existing warnings only) · `next build` green.

## Why this wave

The Feature Scout scan's single loudest signal was **"backend done, never wired"** — at least 7
finished capabilities had no surface. This wave wires six of them. Highest ROI/effort ratio: almost
no new backend logic, just the UI/route/config that exposes work already shipped.

## Commits

| # | Commit | Finding | Type | Files |
|---|--------|---------|------|-------|
| 1 | `d733ce4` | ORGS-5 | config | vercel.json |
| 2 | `7963f1b` | AUTH-3 | new route | api/auth/session/route.ts |
| 3 | `9ca9eff` | AUTH-1 | route + helper + UI | auth.ts, api/auth/{logout,revoke-sessions}, connect/page.tsx |
| 4 | `a5708a7` | RPT-1 | wire-up | trends/page.tsx |
| 5 | `2acb1d0` | ORGD-1 | client control + column | org/ScheduleSelect.tsx, org/[slug]/repositories/page.tsx |
| 6 | `8f5053d` | RPT-2 | data + chart | db/scans.ts, lib/ui.ts, report/{TrendChart,chartHover,DimensionTrends} |

(Scan artifacts committed in `6e40cc0`.)

## What was fixed

1. **ORGS-5 — Retention purge cron registered.** `/api/cron/purge` was fully built + `CRON_SECRET`-guarded
   but absent from `vercel.json`, so in prod it never fired and scan history grew unbounded. Added a daily
   04:00 UTC entry. The route already self-no-ops without a configured retention window, so it's inert until
   a policy is set.
2. **AUTH-3 — `GET /api/auth/session`.** `getSessionState()` already computes status/login/installations/expiry
   on every render, but nothing exposed it to the browser. New JSON endpoint returns the non-sensitive subset
   (installation logins, not ids; no token). Polling it also slides the inactivity horizon for active users.
3. **AUTH-1 — "Sign out everywhere else".** `bumpSessionVersion` existed but only logout/uninstall called it —
   no self-serve kill switch for a leaked/shared cookie. New `POST /api/auth/revoke-sessions` bumps the version
   (killing every other token on next resolve) and re-mints THIS cookie at the new version so only this browser
   survives, surfaced as a button on `/connect`. Also consolidated the same-origin CSRF guard into a shared
   `auth.isSameOrigin` (logout had a private copy — the codebase's own anti-pattern list flags such drift).
4. **RPT-1 — Trajectory GPS on `/trends`.** `forecastTrajectory()` + `<Trajectory>` (OLS slope → projected
   score, level ETA, fit confidence) were wired only into the org rollup; the per-repo trends page drew only
   rear-view lines. Fit over the overall-only history already fetched and rendered the existing server-safe card.
5. **ORGD-1 — Per-repo autoscan cadence control.** `/api/org/schedule` + the rescan cron were complete, but no
   org view ever called them. Added an Autoscan column (off|daily|weekly|monthly) to the repositories
   leaderboard, backed by a small optimistic-with-rollback client select reading the `scanSchedule` already on
   the rollup. Disabled-with-hint when the GitHub App isn't configured (the route would 503).
6. **RPT-2 — Trend dots link to their pinned report.** `HistoryPoint` omitted `headSha` though the DB stores it
   and `reportPermalink()` existed, so a trend point was a dead end. Threaded `headSha` through the history
   selects; the overall `TrendChart` now navigates to the hovered point's `/report/{owner}/{repo}@{sha}` on
   click (a far larger hit target than the dot), with the short sha shown in the tooltip. `reportPermalink`
   moved to client-safe `@/lib/ui` (re-exported from `@/lib/db/scans`) so client + server build the same link.

## Verification (before → after)

| Gate | Baseline | After wave |
|------|----------|-----------|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | — | 0 errors, 2 warnings (both pre-existing in `InstallationRepos`, untouched) |
| `next build` | (not captured at baseline) | ✅ all routes compiled incl. the 2 new auth routes |
| unit tests | none (Playwright e2e only) | unchanged (not run — needs a live server) |

## Patterns established (catalogue additions, items 1–4)

1. **Dormant-backend wire-up** — when a capability is fully built server-side (route + persistence + cron) but
   `grep` of the relevant UI dir for its verb returns nothing, the fix is a thin surface, not new logic. Read
   the value off data the page already loads (e.g. `scanSchedule` on the rollup) before adding a query.
2. **Client-safe helper relocation** — a pure helper (`reportPermalink`) needed by both a server module and a
   client component belongs in a client-safe module (`@/lib/ui`), re-exported from the server module so the
   `@/lib/db` barrel + existing importers don't move. Avoids the "two hand-rolled copies drift" anti-pattern.
3. **Re-mint-at-new-version revocation** — to revoke *other* sessions while keeping the current one, bump the
   shared version then re-issue this cookie at the bumped version. Return whether there was DB authority so the
   UI can be honest in stateless mode.
4. **Optimistic-with-rollback mutation control** — a per-row `<select>`/toggle POSTs, optimistically updates,
   rolls back + surfaces the error on non-2xx, and `router.refresh()` on success. Mirrors the connect list's
   `toggleWatch`.

## What remains (other waves)

Wave 1 (Usage→billing), Wave 3 (fleet reliability incl. the 1 Critical ORGS-1), Waves 4–7 per the INDEX.
Wave-2 leftovers explicitly deferred: an external GitHub-commit link on trend points (the report page already
surfaces the commit) and per-dimension `DimLine` deep-links.

## ⚠ Concurrency note

This wave ran **concurrently with a separate UI-Perfectionist Pipeline-B run on the same `ascent` working
tree**. The two runs' commits are interleaved on branch `vibeman/feature-scout-wave2` (the other run added
badge/a11y/seo/heatmap fixes + its own `docs/harness/ui-perfectionist-2026-06-08/` artifacts). One shared file,
`TrendChart.tsx`, was edited by both: the other run committed `6b675df` (band labels + sr-only table) mid-flight;
this run's RPT-2 edit was rebuilt on top of that version, so both changes coexist and the combined file passes
`tsc` + `next build`. No history surgery was done (it would disrupt the still-active concurrent agent).
