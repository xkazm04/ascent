# Feed - showcase brief

subject: feed
subcategory: data-display
digest: sha256:23236fee1ffbf827
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/data-display/feed/feed.md

- **Read:** `feed.md` (golden path), all five techniques, both applications
  (`react--read-position-and-unseen`, `rust--reverse-chronology-semantics`), and the laws they cite
  (`identity-survives-reuse`, `one-authority-per-vocabulary`, `count-carries-predicate`,
  `derivation-names-recomputation`, `failure-not-empty-success`, `creation-names-reaper`).
- **Rail order** = the golden path's order: reverse-chronology-semantics, live-prepend,
  event-clustering, read-position-and-unseen, feed-retention.

## Scene concept

A fictional org's fleet-activity feed — scans finishing, levels changing, security findings, follow-ups
closing, sync bursts — over ONE store (`feedStore.ts`: a server that is reaped on insert, a client that
holds a page, a held buffer, two anchors, a retention contract, a transport seam). The viewport is the
live-prepend region; the other four regions are the instruments the feed reacts to, so every technique
is a control over the same rows rather than a card of its own. A viewer can use it as a product surface
— scroll, let rows arrive, mark read, page older — and the rail reveals which decision each behaviour is.

## Techniques

### reverse-chronology-semantics
- use_when matched: "tied rows swap places across a refetch"
- mechanism to show: `compareDesc(key)` — (ts desc, seq desc), three-way — imported by every rank site;
  key switch (event vs arrival) re-mints the cursor and both anchors from the same occurrence; a
  refetch shuffles delivery order and counts swaps (0 under the tuple, >0 under timestamp-only at the
  ties a sync burst manufactures); an optimistic note holds no seq and waits outside the ranked list;
  relative labels with absolute recourse; day dividers from the one UTC helper
- region: `ChronologyPanel.tsx`; comparator + tuple in `feedOrder.ts`; refetch/key/post in `feedStore.ts`
- Ascent evidence: `src/lib/db/alert-events.ts` `listAlertEvents` — newest-first on `createdAt`, `take`
  capped (grep: `rg "orderBy: \{ createdAt: \"desc\"" src/lib/db` → alert-events.ts and nine siblings);
  `src/components/org/shared/AlertsMovement.tsx` keys rows by `${it.at}-${i}`
- deviation: no `(createdAt, id)` tiebreaker, no keyset cursor (grep: `rg "cursor" src/lib/db` → only
  id-cursors for batch enumeration in kpi-metrics.ts / retention.ts), timestamp-plus-index row keys
- applications read: `rust--reverse-chronology-semantics.md` — mechanisms taken: comparator copied to
  every rank site with a comment, namespaced ids for one key space, the 72%-collision figure as the
  reason ties are routine, bucket-on-the-sort-expression; nothing cited as Ascent's

### live-prepend
- use_when matched: "keeping the viewport still while rows prepend above"
- mechanism to show: scroll position as a declaration (24px band); `deliver()` as the one merge door —
  identity dedupe, then prepend in one commit at the head or append to the held buffer; the "N new ·
  jump to latest" pill is the held buffer's size; reconnect = cursor walk newer-than the last delivered
  tuple with the replayed boundary row dropped and counted; a failed walk renders a stated seam with a
  refresh control; entrances keyed by identity (set written after commit), first 12 rows only, settled
  under `reduced`
- region: `FeedRegion.tsx` (viewport + controls); rows in `FeedRows.tsx`; deliver/reconnect in `feedStore.ts`
- Ascent evidence: `src/features/inflight/live/liveWarRoomFold.ts` `foldRepoEvent` prepends a
  newest-first ticker capped at `TICKER_MAX`, keyed by a monotonic id (grep: `rg "prepend|scrollTop" src`
  → liveWarRoomFold.ts, LiveWarRoomPanels.tsx, OrgShell.tsx, AthenaPanel.tsx)
- deviation: no reader-mode contract, no held buffer or "N new", no catch-up walk after a dropped stream
- applications read: none for this technique in the index; the react application's `useChatScroll`
  band-and-`atBottom` pattern informed the band (a boolean without a count is the half-adoption it names)

### event-clustering
- use_when matched: "one busy producer drowns the whole feed"
- mechanism to show: `clusterRows()` recomputed in the `useFeed` memo, never stored; explicit predicate
  (consecutive · `actor:sync` relation declared per kind · 10-minute window · cap 50 · `NEVER_CLUSTER`
  excludes failures and security); identity = relation + oldest member's seq, position = newest member;
  extend-the-run updates the row in place and keeps it expanded; the row states relation · count · span
  and shows its worst member; the digest/flat-log toggle is the same storage grouped or not
- region: `ClusterPanel.tsx`; derivation in `feedOrder.ts`; row in `FeedRows.tsx`
- Ascent evidence: `src/lib/alerts.ts` `claimRegressionAlert` — one alert per repo per cooldown window
  (grep: `rg "cluster|coalesce|cooldown" src/lib/alerts.ts` → the cooldown block at ~369-424; no
  read-time grouping anywhere)
- deviation: suppression at write time instead of a view at read time; history and movement lists
  render one row per event
- applications read: none for this technique in the index

### read-position-and-unseen
- use_when matched: "unread badge flashes then zeroes on open"
- mechanism to show: the anchor is the `(ts, seq)` tuple; `entry` frozen in the initial state renders
  the divider and the delta, `stored` advances on mark-all-read and heartbeat and the delta is never
  computed against it; mark-all-read = anchor-set-to-head over delivered rows, idempotent (writes
  counter); `unseen` and `sinceEntry` are filters over occurrences (held included) under the active
  predicate; the filter chips re-scope list and badge together and the badge names its scope; display
  caps at 99+; the seen definition (opened and marked) is stated in the region
- region: `ReadPanel.tsx`; anchors in `feedStore.ts`; derivations in `useFeed.ts`
- Ascent evidence: `src/lib/db/members.ts` `getAlertsWatermark` / `markAlertsSeen`
  (`Membership.alertsSeenAt`, join-date fallback) and `src/components/org/shared/AlertsMovement.tsx`
  (`movementBadgeLabel` → `9+` past the cap) (grep: `rg "unseen|lastSeen|seenAt|unread" src` →
  AlertsMovement.tsx, members.ts, api/org/alerts/route.ts)
- deviation: bare-timestamp watermark stamped with `now` on open; the client zeroes the badge from a
  local `seen` flag rather than re-deriving
- applications read: `react--read-position-and-unseen.md` — mechanisms taken: the frozen-at-entry
  `useState` initializer vs the advancing heartbeat store, `countUnread` as a comparison with a stated
  predicate, the bare-timestamp-anchor defect on a tied key; nothing cited as Ascent's

### feed-retention
- use_when matched: "cursor past the horizon renders as no more history"
- mechanism to show: `DEFAULT_RETENTION` declared beside the store (age bound × per-actor floor ×
  named archive), horizon as a setting, `REAPER` named and run by `admit()` on every insert over settled
  rows only, floor cut on the one comparator; the list's edge says "showing the last N days · retained ·
  archive"; `pageOlder()` past the horizon returns the oldest window + `truncated`; `forfeitAtHorizon()`
  counts unseen rows the reaper took, snaps the anchor, and the region says so
- region: `RetentionPanel.tsx`; contract in `feedRetention.ts`; edge marker in `FeedRegion.tsx`
- Ascent evidence: `src/lib/db/retention.ts` — per-org settings with env defaults, keep-window ×
  age bound, settled-only queue pruning, wall-clock budget, `retention.prune-audit` label (grep:
  `rg "retention|prune" src/lib/db/retention.ts`)
- deviation: no surface shows its horizon; `AlertEvent` is deliberately outside the purge, so the alert
  history has no declared retention and stops mute at `take: 30`
- applications read: none for this technique in the index

## Out of the read

- `pagination@table` (shared, owned by Table): the scene pages older on the keyset tuple but the full
  cursor discipline (opacity, seeding a new consumer) is Table's showcase.
- The union rules (per-source window budgets, merge horizon): one producer here; the fixture is one
  store, so there is no starvation or merge horizon to show.
- Render throttling (streaming-output): arrivals are batched per click, not on a timer — the scene has
  no autonomous loop, so no pause control is owed.
- The scrolled-past seen definition (IntersectionObserver + dwell): the scene chooses "opened and marked"
  once and states it; a second definition in one scene would be the drift the technique warns against.
- Multi-device anchor convergence by max: anchors are scene-local.

## Gates run

`npx tsc --noEmit` (one pre-existing error in the gitignored `.next/dev/types/validator.ts`, not the
scene) · `npx vitest run src/features/shared/surfaces src/lib/org` (bijection + `Scene.dom.test.tsx`
green; sibling scenes still being authored fail their own tests) · LOC ≤200 under `src/features/**`.
Observation (headless Chromium screenshot) is the Director's step in builder mode.
