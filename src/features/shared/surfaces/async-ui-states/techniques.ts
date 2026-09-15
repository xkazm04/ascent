// The drawer entries for the async-ui-states scene: one per technique of the registry subject
// (authored against sha256:4d89ccb3b7b69ed0, 2026-09-06), in the golden path's order. `mechanism` is
// the React/Tailwind mechanism the region demonstrates; `source` is the scene's own code; `inAscent`
// cites a real Ascent file read for this scene; `deviation` names where Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "state-model",
    title: "The state model",
    mechanism:
      "`useRequestRegion` is the request machinery: an outstanding-request count, a sticky `settled` bit set by the first completion (success or failure) and unset only by `reset()`, the last error cleared when the next request starts, and the windowing key the held content was produced under. " +
      "`deriveState()` is a pure function over those inputs, and its order is the model — held content wins (a failed or in-flight refresh stays settled-data), failure outranks loading when nothing is held, empty needs the sticky bit, unstarted collapses into loading. " +
      "Every request carries a sequence token; a response whose token is no longer the latest is dropped, never applied — the race button issues a slow request then a fast one and the ledger counts the stale one as dropped. " +
      "The ledger shows the four inputs and the derived word beside them, and the forbidden edges are listed because the ordering makes them unreachable rather than merely avoided.",
    source: S.SRC_STATE,
    inAscent: {
      file: "src/components/org/followups/FollowupHistory.tsx",
      note: "Loading, error and rows are one union with `loading` as the initial value, so empty copy is unreachable before a response; a `cancelled` flag drops a stale response; the error branch is a retry, never the empty copy.",
    },
    deviation:
      "State is hand-maintained per component (`RecEvent[] | \"loading\" | \"error\"`, `\"idle\" | \"loading\" | \"error\" | \"done\"` in DimensionTrends): no shared derivation, no refreshing state, and the sticky bit exists only where a union happens to start at `loading` — `fleetMapDerive.ts` is the one place `settled` is computed explicitly.",
  },
  {
    slug: "placeholder-design",
    title: "Placeholder design",
    mechanism:
      "The repository chrome — search chips, sort, pager, network dial, state chip — renders from the query and never unmounts; only the content region below it has a state. " +
      "In `loading` it renders `GhostRows`: the same `ROW` class and height the rows use, bar widths seeded by position, `aria-hidden`, with `aria-busy` on the region. " +
      "The ghost's entrance is delayed by `GHOST_DELAY_MS` (Ascent's own 150ms) through `animation-delay` with `both` fill, so a warm response lands before a pixel of it paints; under `reduced` the animation is a 1ms hold with the same delay — the window survives the motion-off path. " +
      "The delay lives on the ghost only: the moment rows exist they render, and a refresh over held rows shows an ambient chip, never a ghost.",
    source: S.SRC_GHOST,
    inAscent: {
      file: "src/components/ui/deferPolicy.ts",
      note: "`QUIET_PLACEHOLDER_DELAY_MS = 150` mirrors `.reveal-quiet` in globals.css — the delay rides on the placeholder's entrance, keeps its window under reduced motion (`ascent-hold-hidden`), and `OrgTabGap` promises only the geometry it knows (a reserved height).",
    },
    deviation:
      "`PageSkeleton.tsx` ghosts the chrome too (a full-page `animate-pulse` silhouette with header and stat row) and paints on the first frame with no delay; `DimensionTrends` ghost cards match geometry but also skip the window.",
  },
  {
    slug: "action-busy-states",
    title: "Action busy states",
    mechanism:
      "`BusyButton` takes the operation as a promise and owns everything else: the click handler checks and sets an `inFlight` ref before any state update, so a second press in the same task finds the door closed even though React has not re-rendered `disabled` yet. " +
      "While busy it renders a real spinner beside a truthful label inside a fixed `min-w`, sets `disabled` and `aria-busy`, and restores itself in `finally` — on success, on rejection, and on the 4s bound that beats an eternal spinner. " +
      "The queue keys busy to the item pressed: approving row one leaves rows two and three actionable, and the outcome lands in a polite live region. " +
      "The scripted double-press fires two clicks synchronously; the counter reads two presses, one submission.",
    source: S.SRC_BUSY,
    inAscent: {
      file: "src/components/CopyForLlm.tsx",
      note: "The `inFlight` ref is set synchronously in the handler and released in `finally`, so a rapid double-click cannot double-fire the copy; `recStatusUi.tsx` pairs `aria-busy` with a no-op on overlapping changes.",
    },
    deviation:
      "No shared busy-control primitive: `DecisionControl.tsx` sets a `busy` state before its fetch and clears it after (a state-driven disarm with a one-frame window), and each of the ~20 `aria-busy` sites hand-rolls spinner, disable and restore.",
  },
  {
    slug: "empty-state-design",
    title: "Empty state design",
    mechanism:
      "Picking a world issues a request with `drop: true`, so the follow-ups region ghosts and cannot render an empty until the response settles it — the readout shows `settled: false → empty not entitled` while in flight. " +
      "`emptyCause()` branches on the raw collection first: forty raw rows with zero filtered is no-match (name the predicate, offer to clear it), zero raw with a missing prerequisite names the setup, hidden-by-role asks for access, and a drained queue is a check, not an onboarding pitch. " +
      "Each cause carries its own copy register in `EMPTY_COPY`, and the chrome — the filter chip and the picker — stays through every state. " +
      "Failure has no shared rendering here: it is the alerts region's own state.",
    source: S.SRC_EMPTY,
    inAscent: {
      file: "src/components/EmptyState.tsx",
      note: "One canonical empty/notice component with page and section variants; `FollowupsTab` uses it with instructional future tense ('Scan some repositories and their gaps land here').",
    },
    deviation:
      "Cause is not an input: `EmptyState` has no notion of first-run vs no-match vs permission, so each call site chooses copy by hand, and no site branches on the raw collection to tell a filtered-empty from a genuinely empty one.",
  },
  {
    slug: "failure-states",
    title: "Failure states",
    mechanism:
      "With the failure armed, a load into an empty alerts region settles into `failed`: a `role=\"alert\"` block with its own glyph and tone, copy mapped once in `FAILURE_COPY` at the user's altitude, and a Retry that is a `BusyButton` whose promise is the reissued request — the same request, filters and place kept. " +
      "The class decides the action: unreachable offers Retry and escalates to 'still can't reach' after two failures; unauthorized offers sign-in and no retry. " +
      "With rows held, a failed refresh keeps them on screen — the derivation never demotes held content — and admits the failure beside them with how stale they are, from a seconds clock that restarts when a response applies. " +
      "Every rendered failure increments the reported counter: calm outside, loud inside.",
    source: S.SRC_FAILURE,
    inAscent: {
      file: "src/components/org/followups/FollowupHistory.tsx",
      note: "The error branch is a `role=\"alert\"` line with a Retry that bumps a nonce and reissues the same fetch for the same id — distinct from the empty copy by construction; `DimensionTrends.tsx` does the same through `EmptyState` with an AbortController superseding earlier loads.",
    },
    deviation:
      "Every failure state read offers Retry regardless of class (no unauthorized branch anywhere), none states how stale held data is after a failed refresh, and `FollowupHistory` colours its alert with raw `text-orange-300` rather than the `warn`/`danger` tokens.",
  },
  {
    slug: "arrival-choreography",
    title: "Arrival choreography",
    mechanism:
      "A row's entrance is decided during render from three facts: the last applied response was tagged `arrival` (the loading → settled-data edge), motion is not reduced, and the row's id is not in the surface-scoped seen-set — the reduced path is the same 'already seen' branch, not a second implementation. " +
      "Entering rows get `riseAnimation(i)`: 160ms per item, 40ms steps, capped at the first eight; settled rows get `none`. " +
      "The seen-set is written by the entrance itself (a delegated `animationend` on the list) and, for rows that appear settled, on commit; it outlives the rows and is emptied only by the identifying-axis change in `search()`. " +
      "Poll, resort and page turns are tagged `refresh` or `window`, so they animate nothing; the instrument shows the last edge and what is entering this render.",
    source: S.SRC_ARRIVAL,
    inAscent: {
      file: "src/app/globals.css",
      note: "`.stagger-children` is the brand cascade — 40–50ms steps capped at the sixth child, 360ms fade-up, `animation: none` under reduced motion — and `OrgTabChunks.tsx` keys the panel on the tab so it plays once per switch.",
    },
    deviation:
      "The cascade is coupled to mount, not to the load edge: any remount replays it, and no identity seen-set exists, so a refetch that remounts a list re-animates rows the user already saw.",
  },
  {
    slug: "windowing-vs-identifying-keys",
    title: "Windowing vs identifying keys",
    mechanism:
      "`KEY_CLASS` declares the classification once, where the key is defined: `term` is identifying, `page` and `sort` are windowing. " +
      "The handlers apply the five-consumer table from it — `search()` drops content, resets the sticky bit, the scroll, the page and the seen-set; `turnPage()` and `resort()` keep the rows, mark them superseded, and never touch the term — so the arrow runs one way only. " +
      "The classification lives on the input side: `windowKey(page, sort)` is recorded when a request is issued, and `superseded` is the live window compared to it, not a field read back from a payload. " +
      "Superseded dims the content region itself (the provisional thing is the content), while refreshing over the same key is an ambient chip.",
    source: S.SRC_KEYS,
    inAscent: {
      file: "src/lib/org/orgTabs.ts",
      note: "`TAB_SCOPED_PARAM_KEYS` + `buildOrgTabUrl()` is a one-directional dependent-coordinate reset: switching the tab (identifying) clears `cursor`, `subject`, `technique`… (windowing), while a param change never touches the tab.",
    },
    deviation:
      "No list in Ascent keeps previous content across a windowing change: `useDeferredValue` / keep-previous-data appear nowhere, and the classification is expressed only for URL params, never for a fetch key, so a sort or page change re-ghosts.",
  },
];
