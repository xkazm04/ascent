# Feature Scout — Launch Fleet Map (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

The `/launch` Fleet Map renders the signed-in user's GitHub App installations as one
constellation per org, each repo a star whose brightness scales with its persisted maturity
score. It hydrates live per-org via `/api/app/repos`, tallies fleet-wide stats, and links each
org to `/org/[login]`. Compared to the deep org surface it links into (movers, trends, segments,
forecasts, leverage moves, "Scan all", repo-level reports), the map is almost entirely passive:
it shows averages but supports no drill-down to a repo, no action, no filtering, no freshness,
and no sharing. The richest opportunities below close that gap between "beautiful landing" and
"command surface."

## 1. Stars are dead ends — no click-through from a repo star to its report
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/launch/ConstellationField.tsx:99-107
- **Scenario**: A user lands on /launch after OAuth, spots a dim red star in their busiest org, and instinctively clicks it expecting to see *which repo* is weak and why — the whole promise of "each repo a star."
- **Gap**: Repo stars (`<circle>`) carry only a `<title>` tooltip (`{r.fullName} · {r.level} {r.overall}`). The only navigable elements in the entire field are the org name and the "open →" link, both pointing at `/org/${c.login}`. There is no link from a star to `reportPermalink(fullName)` (the helper exists in `src/lib/ui.ts:24` and `/report/[owner]/[repo]/page.tsx` is fully built). Grep of `ConstellationField.tsx` for `onClick|href|Link` confirms zero per-star navigation. The map literally renders every repo as an individual, identifiable object and then makes none of them actionable.
- **Impact**: Every user. The map's core metaphor ("click a star, see the repo") is unfulfilled — the visualization can only ever bounce you up to the org dashboard, never down to the unit it draws. Drill-down is the single feature that converts the map from decoration into navigation.
- **Fix sketch**: Wrap each scanned `<circle>` in an `<a href={reportPermalink(r.fullName)}>` (SVG `<a>` works, or render a transparent overlay of positioned `<Link>` hotspots). Add `cursor-pointer`, a focus ring, and `tabIndex` for keyboard reach; keep the `<title>` as hover preview. ~0.5 day.

## 2. No way to scan unscanned/stale repos from the map
- **Severity**: High
- **Category**: feature
- **File**: src/components/launch/FleetMap.tsx:108-124
- **Scenario**: A first-time user connects an org and lands on a constellation of mostly *faint grey* stars ("not scanned"). The map's stated payoff — "scores stream in below" — never arrives, because nothing has been scanned yet, and the map offers no button to start.
- **Gap**: The map shows `scanned/total` and dims unscanned repos (`starLook(null)` → grey, `fleetMapStars.ts:54`) but provides no scan trigger. The capability already exists: `/api/org/scan` (SSE bulk scan of watched repos, supports `staleOnlyDays`) and `OrgScanButton.tsx` drive exactly this on the org dashboard. None of it is wired to `/launch`. For a brand-new install the map is a near-empty grey field with a dead end — the worst possible first impression on the page the OAuth callback deliberately lands on.
- **Impact**: New users / activation. Surfacing a per-org "Scan all" (or fleet-wide "Scan everything stale") on the map turns the entrance into the activation moment — stars literally light up as the SSE stream reports each repo, fulfilling the "scores stream in" promise live instead of requiring a detour to each org dashboard.
- **Fix sketch**: Add an `OrgScanButton`-style control to each `ConstellationField` header (and a fleet-level one in the `FleetMap` header) that POSTs to `/api/org/scan` and consumes the SSE stream, patching `RepoStar.overall` in place as `repo` events land. Reuse `readSSE` from `@/lib/sse`. ~1.5 days.

## 3. Map shows no movement — no "what changed" / risers & fallers
- **Severity**: High
- **Category**: user_benefit
- **File**: src/components/launch/FleetMap.tsx:60-84
- **Scenario**: A returning eng leader opens /launch weekly to answer one question: "what moved since last week — what's regressing, what's improving?" The map shows only static present-state averages.
- **Gap**: `mapRepos` (`fleetMapStars.ts:59`) keeps only `overall`/`level`, and the fleet `stats` (`FleetMap.tsx:60`) compute only counts and a flat average — no deltas, no trend, no time dimension. The org dashboard already computes exactly this (`getOrgMovers` → gainers/regressers with `dOverall`/`levelDelta`, rendered as `MoversList` in `org/[slug]/page.tsx:20-53`), and `RepoState` could expose period deltas. The map, the most-glanced surface, surfaces none of it. Grep confirms no `movers`/delta/trend usage anywhere under `src/components/launch`.
- **Impact**: Returning power users / leadership. Movement is the reason to revisit a dashboard; a static snapshot is checked once. Pulsing/annotating stars that rose or fell since the last scan (a green ▲ halo on risers, amber ▼ on fallers, plus a fleet-level "3 up · 1 down this week" chip) makes the map worth opening repeatedly and turns it into a genuine early-warning surface.
- **Fix sketch**: Extend `/api/app/repos` (or add `/api/app/fleet`) to include a per-repo `dOverall` over a window (reuse the org-rollup delta machinery). Render a small directional overlay glyph per star and add a fleet movers chip beside the existing `Stat`s. ~2 days.

## 4. No filtering, sorting, or grouping across the fleet
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/launch/FleetMap.tsx:127-135
- **Scenario**: A platform owner with 8 orgs and 200 repos wants to see "only repos below L3," "only private," "only my watched repos," or "worst-first" — to triage at a glance rather than hunt across constellations.
- **Gap**: The map renders all constellations in a fixed grid and every star unconditionally; there is no search box, level/visibility filter, watched toggle, or sort. The data to support it is already in hand — `RepoStar` carries `private` and `level`, and `RepoState` (`org-rollup.ts:15`) carries `watched`/`scanSchedule` (currently dropped by `mapRepos`). Grep for `filter|search|sort|input` under `src/components/launch` returns only the internal average reduction, no UI controls.
- **Impact**: Power users at fleet scale. Beyond ~3 orgs the constellation grid becomes a "where's Waldo" of stars; filtering/highlighting (e.g. dim everything ≥L3 so the at-risk repos pop) is what makes the map usable as an operational triage tool rather than a hero image.
- **Fix sketch**: Add a controls bar in the `FleetMap` header: text search, a level-band multiselect, a "watched only" toggle, and a sort key. Apply as a derived filter over `constellations`; dim/hide non-matching stars rather than removing them (preserve the constellation shape). Thread `watched` through `mapRepos`. ~1.5 days.

## 5. No shareable fleet snapshot / OG image of the constellation
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/launch/page.tsx:44-50
- **Scenario**: An eng leader wants to drop "our fleet maturity map" into a board deck, a Slack channel, or a status page — a single image that says "here's where all our repos stand."
- **Gap**: `/launch` is a live, auth-gated client view with no export, no public/tokenized snapshot, and no OG image. The product already invests heavily in shareable maturity artifacts — repo SVG badges (`/api/badge/[owner]/[repo]`, `/badge` generator) and `ImageResponse`-based OG images for repo reports (`report/[owner]/[repo]/opengraph-image.tsx`, root `opengraph-image.tsx`) — but nothing renders the *fleet/constellation* as a portable asset. Grep confirms no `embed`/`snapshot`/`ImageResponse` under the launch surface.
- **Impact**: Leadership reporting + organic growth. A beautiful constellation is the product's most screenshot-worthy surface; an official share/embed (PNG via `ImageResponse`, or a read-only `/fleet/[token]` link) extends the existing badge-driven distribution loop to the org level and gives leaders a recurring artifact to circulate.
- **Fix sketch**: Add `src/app/launch/opengraph-image.tsx` (or `/api/fleet/snapshot`) that renders the constellation from the same `fleetMapStars` math via `ImageResponse`, plus a "Copy share image / embed" affordance on the page. Reuse the existing OG-image patterns. ~2 days.

## 6. Map is a one-shot fetch — no live hydration or auto-refresh after load
- **Severity**: Medium
- **Category**: functionality
- **File**: src/components/launch/FleetMap.tsx:30-57
- **Scenario**: A user leaves /launch open as their command-center tab (the page literally bills itself as "mission control") while a scheduled rescan or a teammate's scan runs. The stars never change until a manual reload.
- **Gap**: The hydration `useEffect` fires once per `installations` change: one `fetch` per org, then static. There is no polling, SSE subscription, or revalidation — a scan that completes elsewhere (cron rescan via `/api/cron/rescan`, a teammate's "Scan all," the org `LiveWarRoom` SSE) is invisible here until refresh. The org dashboard already has a live SSE war-room (`LiveWarRoom.tsx`); the entrance surface that's most likely to be left open has the least liveness.
- **Impact**: Anyone using /launch as a passive monitor / wall display. Periodic revalidation (or wiring into the scan SSE) lets the constellation update itself — stars brighten as scheduled scans land — which is the difference between a static landing page and a live "mission control" befitting the framing.
- **Fix sketch**: Add a lightweight interval refetch (e.g. revalidate each org every 60–120s, or `visibilitychange`-gated) to the hydration effect, or subscribe to the scan SSE stream and patch `overall` in place. Diff results so unchanged stars don't re-animate. ~1 day.
