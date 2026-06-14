# Feature Scout Fix Wave 6 — Live ops (war-room + fleet map)

> 6/6 findings closed, on `master` (direct, per user). 4 commits.
> Baseline preserved: `tsc` 0; **vitest 451/451**; eslint 0; `next build` ✓.

One mental model: **make the most-glanced surfaces live, goal-aware, and interactive** — the war
room and the `/launch` fleet map both displayed static absolutes; the data to make them dynamic
(goals, rollup windows, movers, the SSE scan) already existed and just wasn't wired in.

## Commits

| # | Commit | Findings | What shipped |
|---|---|---|---|
| 1 | `c680613` | WAR-1, WAR-2, WAR-3 | Goal banner (target meter + PaceChip + deadline countdown) · "+N since kickoff" campaign delta (rollup windowed on the goal's createdAt) · opt-in 15-min auto-relaunch (localStorage) |
| 2 | `57c6d13` | WAR-4 | "TV mode" (fullscreen + wakeLock) · signed/expiring read-only share link (`/live/shared/[token]`, owner-minted, capability-gated, noindex, read-only) |
| 3 | `58fe98f` | MAP-2 | Per-org "Scan" button on the fleet map — reuses `/api/org/scan` SSE, brightens stars in place |
| 4 | `382ebff` | MAP-3 | 30-day per-repo movers on the map (ring + tooltip delta) via a `getOrgMovers` extension to `/api/app/repos`, + a fleet "movers · 30d" chip |

## What was fixed

1. **WAR-1 — Goal banner.** The live page fetches the rallying goal (first un-achieved, else latest)
   via `listGoals` and the WarRoomHeader shows a banner: label + `PaceChip` + target `Meter` + "N to
   goal" + a deadline countdown. The whole goals system existed; the wall just never imported it.
2. **WAR-2 — Campaign baseline.** `getOrgRollup` is called with the goal's `createdAt` as the window
   start, and the banner shows the cohort-matched `deltas.overall` as "+N since kickoff".
3. **WAR-3 — Auto-relaunch.** An opt-in "Auto-relaunch every 15 min" toggle (localStorage-persisted)
   re-runs the scan for an unattended wall, re-arming after each run, guarded against overlap.
4. **WAR-4 — Kiosk + share.** A "TV mode" button (fullscreen + screen wakeLock, best-effort) and a
   signed, expiring, read-only share link: `signLiveShareToken`/`verifyLiveShareToken` (HMAC over
   `{org,exp}`, inert without `LIVE_SHARE_SECRET`/`AUTH_SECRET`); owner-gated `POST /api/org/live-share`
   mints it; `/live/shared/[token]` verifies it OUTSIDE the org session gate (the token is the
   capability) and renders the wall **read-only** (noindex) — no scan trigger (that stays session-gated),
   exposing only the rollup the dashboard already shows.
5. **MAP-2 — Scan from the map.** Each org constellation gains a "Scan" button that runs the existing
   `/api/org/scan` SSE bulk scan and brightens each star in place as `repo` events land — so the
   near-empty grey field a new install lands on (the OAuth callback destination) can be lit on the spot.
6. **MAP-3 — Movers on the map.** `/api/app/repos` now attaches a 30-day `dOverall` per repo (from
   `getOrgMovers`); moved stars get a thin directional ring (emerald up / orange down) + the delta in
   the tooltip, and the header shows a fleet "movers · 30d ▲N ▼M" chip.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 451/451 |
| eslint (changed) | 0 errors |
| `next build` | ✓ |

## Security note (WAR-4 share link)

`/live/shared/[token]` is a NEW unauthenticated read surface. It's gated by an HMAC-signed, expiring
token (the capability), is **read-only** (cannot trigger the session-gated scan), exposes only the
same `getOrgRollup` data an owner chose to share, is `noindex`, and the mint is owner-gated +
same-origin. A leaked link expires (7-day TTL) and grants nothing but a read of one org's wall.

## Patterns reinforced

- **Wire the data that already exists** — WAR-1/2/MAP-3 are pure consumption of `listGoals` /
  `getOrgRollup` windows / `getOrgMovers`; the heavy lifting was already done server-side.
- **Patch-in-place over SSE** — MAP-2 and the war room both fold streamed `repo` events into local
  state so a surface updates live without a refetch.
- **Capability tokens for an auth-bypass surface** — a signed/expiring HMAC token + read-only render
  is how you put private data on an unauthenticated screen safely (WAR-4).

## What remains (from the INDEX)

Wave 5 Planning · Wave 8 Growth/onboarding · Stripe (CRED-1/CRED-3, deferred) · notifications/email
(excluded) · 49 mediums / 4 lows.
