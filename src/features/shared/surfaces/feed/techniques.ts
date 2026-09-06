// The drawer entries for the feed scene: one per technique of the registry's `feed` subject (authored
// against sha256:23236fee1ffbf827, 2026-09-06), in the golden path's order. `mechanism` explains the
// React/Tailwind/Motion mechanism the region demonstrates; `source` is the scene's own code; `inAscent`
// cites the real Ascent file that already realizes the technique; `deviation` names where Ascent
// falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "reverse-chronology-semantics",
    title: "Reverse-chronology semantics",
    mechanism:
      "feedOrder.ts defines the order once: `compareDesc(key)` ranks by the chosen key's timestamp descending, then by the authority's `seq` descending, three-way so equal keys fall through to the tiebreaker. " +
      "The store, the merge door, the history page, the reaper's floor and the read-position anchor all import that one function; the timestamp-only comparator exists only for the demo. " +
      "The key switch (event vs arrival time) re-mints the cursor and both anchors from the same occurrence, so nothing orders by one time and anchors by the other; the late-arrival button shows the row assembling the past at its true position under event time and sitting at the head under arrival time. " +
      "A refetch shuffles delivery order and re-sorts: the tuple comparator renders the same sequence (0 swaps) while the timestamp-only one lets the stable sort fall to delivery order at every tie a sync burst manufactures. " +
      "An optimistic note is stamped by the renderer's clock and holds no `seq`, so it waits in a pending strip outside the ranked list until the server confirms. " +
      "Labels are relative with the absolute time on hover and in the accessible name; day dividers come from the same helper on the scene's one UTC clock.",
    source: S.SRC_CHRONOLOGY,
    inAscent: {
      file: "src/lib/db/alert-events.ts",
      note: "`listAlertEvents` reads the alert history newest-first on `createdAt` (arrival time at this store) with a hard `take` cap — the feed shape, ordered by the authority's stamp.",
    },
    deviation:
      "Ascent's feeds order by `createdAt` alone: no `(createdAt, id)` tiebreaker on the query, no keyset cursor (a fixed `take: 30`), and the client (`AlertsMovement.tsx`) keys rows by `${at}-${index}` — timestamp-plus-position, the identity the technique forbids.",
  },
  {
    slug: "live-prepend",
    title: "Live prepend",
    mechanism:
      "The viewport's `onScroll` turns the reader's position into a declaration: within a 24px band of the top the feed follows, beyond it the reader is reading. " +
      "`deliver()` is the one merge door — it dedupes by identity against everything already delivered or held, then either prepends the batch to the client in one commit (a burst of twelve is one flush) or appends it to the held buffer, so nothing above a reading viewport ever changes. " +
      "The pill is the held buffer's exact size; invoking it flushes, scrolls to the head and re-arms follow mode. " +
      "A dropped connection resumes by a cursor walk newer-than the last delivered tuple — the replayed boundary row is dropped at the door and the readout says how many — and a failed walk renders a stated seam with a refresh control rather than a clean resume. " +
      "Entrances are keyed by identity in a set written after commit, play only within the first twelve rows, and are settled under `reduced`.",
    source: S.SRC_PREPEND,
    inAscent: {
      file: "src/features/inflight/live/liveWarRoomFold.ts",
      note: "`foldRepoEvent` prepends each streamed result to a newest-first ticker capped at `TICKER_MAX`, keyed by a monotonic id the component mints — identity-keyed rows in a live top-growing list.",
    },
    deviation:
      "The live ticker has no reader-mode contract: rows insert above whatever the viewer is reading, there is no held buffer or 'N new' affordance, and a dropped SSE stream has no catch-up walk — the war room reloads the world.",
  },
  {
    slug: "event-clustering",
    title: "Event clustering",
    mechanism:
      "`clusterRows()` is a derivation over the sorted atomic rows, recomputed in `useFeed`'s memo on every change and stored nowhere; the digest/flat-log toggle is the same storage grouped or not. " +
      "The predicate is explicit and lives with the event vocabulary: consecutive rows, one relation key (`actor:sync`, declared per kind), each within ten minutes of the previous member, at most fifty members — and `NEVER_CLUSTER` excludes failures and security findings by kind. " +
      "A cluster's identity is its relation plus its oldest member's `seq`, so extending the newest run updates the row in place, keeps its React key, and keeps it expanded; its position is its newest member, so a live run sorts at now. " +
      "The row states what it counted — relation, count, span — and shows its worst member's outcome on the collapsed line. " +
      "The unseen derivation and the held pill count occurrences, not rows, so folding never hides an arrival from either.",
    source: S.SRC_CLUSTER,
    inAscent: {
      file: "src/lib/alerts.ts",
      note: "`claimRegressionAlert` collapses repeat regressions for one repo inside a cooldown window into a single alert — a per-relation window, but applied at write time to the notification, not at read time to a view.",
    },
    deviation:
      "No read-time clustering exists: the alerts history and the movement list render one row per event, so a rescan sweep that raises forty regression alerts fills the popover with forty rows; the cooldown suppresses (drops) rather than folds.",
  },
  {
    slug: "read-position-and-unseen",
    title: "Read position and unseen",
    mechanism:
      "The stored thing is an anchor — the same `(ts, seq)` tuple the cursor uses — and every count is a comparison: `unseen` filters occurrences (held buffer included) newer than the stored anchor under the active filter's predicate, so the badge cannot drift, only lag. " +
      "Two anchors do two jobs: `entry` is frozen in the store's initial state and renders the 'new since you last looked' divider and delta; `stored` advances on mark-all-read and on the heartbeat, and the delta is never computed against it — which is why the heartbeat cannot zero what the surface is about to show. " +
      "Mark-all-read is anchor-set-to-head over the rows the reader was actually delivered (held rows do not count) and is idempotent: a second click writes nothing, and the writes counter proves it. " +
      "The filter chips re-scope the list and the badge together, and the badge label names the scope; the display caps at 99+ while the derivation stays exact. " +
      "The seen definition is chosen once and stated in the region: opened and marked.",
    source: S.SRC_READ,
    inAscent: {
      file: "src/lib/db/members.ts",
      note: "`getAlertsWatermark` / `markAlertsSeen` store one `Membership.alertsSeenAt` per (reader, org) and derive 'what moved since you last looked' by comparison; a never-read member falls back to the join date, and the badge shows `9+` past the query cap (`AlertsMovement.tsx`).",
    },
    deviation:
      "The watermark is a bare timestamp stamped with `now` on open (surface-opened semantics), not the ordering tuple of the newest seen row, so two records in one tick straddle it; and `useOrgMovement` zeroes the badge optimistically from a local `seen` flag rather than re-deriving from the advanced anchor.",
  },
  {
    slug: "feed-retention",
    title: "Feed retention",
    mechanism:
      "`DEFAULT_RETENTION` is declared beside the store the feed is created from: an age bound composed with a per-actor floor and the archive named; the horizon is a setting the region changes, not a constant. " +
      "The reaper has a name (`REAPER`) and an invocation — `admit()` runs it on every insert — and it reaps only settled rows, so the running scan at the head is never eligible however old it gets; the floor is cut on the one comparator, so a tie at the K-th row keeps exactly K. " +
      "The list's edge renders as an edge: 'showing the last N days · retained · archive', and paging older with a cursor past the horizon returns the oldest window plus a truncation marker, never an empty page the client would read as 'no more history'. " +
      "When the reaper takes rows newer than the read-position anchor, `forfeitAtHorizon` counts them, snaps the anchor to the horizon and the region says how many unseen events were removed instead of zeroing the badge into 'nothing happened'.",
    source: S.SRC_RETENTION,
    inAscent: {
      file: "src/lib/db/retention.ts",
      note: "The purge cron is a named reaper with settings (`retentionMaxScans` / `retentionAuditDays` per org, env defaults), a per-repo keep-window composed with an age bound, a settled-only predicate for queue rows, and a wall-clock budget — the reaper half of the technique, written down.",
    },
    deviation:
      "The horizon is invisible from the surfaces: the alerts history renders a mute stop at `take: 30`, no feed says 'showing the last N days', and `AlertEvent` rows are deliberately outside the purge so that feed has no declared retention at all.",
  },
];
