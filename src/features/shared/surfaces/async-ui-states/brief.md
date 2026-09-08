# Async UI states - showcase brief

subject: async-ui-states
subcategory: feedback-and-style
digest: sha256:4d89ccb3b7b69ed0
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/feedback-and-style/async-ui-states/async-ui-states.md

Read: the golden path, all seven techniques (`state-model`, `placeholder-design`,
`action-busy-states`, `empty-state-design`, `failure-states`, `arrival-choreography`,
`windowing-vs-identifying-keys`), the three applications (`react--action-busy-states`,
`react--state-model`, `react--windowing-vs-identifying-keys`) and the cited laws
(`failure-not-empty-success`, `identity-survives-reuse`, `count-carries-predicate`).

## Scene concept

A fictional org page composed of independent async regions, each with its own simulated request at
a scene-wide latency dial (warm 40ms sits inside the ghost's 150ms window; slow 900ms does not): a
repository search (search chips = identifying, page and sort = windowing) whose machinery three
instruments read — the state ledger, the key classification with its five-consumer table, and the
arrival seen-set — plus a review queue with per-item busy controls, a follow-ups region that settles
into five typed empties, and an alerts region whose next request can be made to fail. A viewer can
search, page, refresh, race two requests, approve rows, pick a world and break the alerts feed for a
minute without knowing it is a showcase; the rail reveals which rule each region is keeping.

`reduced` and `volume` are props; nothing reads a media query. No framer-motion: the placeholder,
cascade and spinner are CSS keyframes mounted in one `<style>`. Fixtures are seeded (mulberry32) and
the scene says so on screen; `volume` sizes the repository universe the search runs over.

## Techniques

### state-model
- use_when matched: "a slow stale response lands after a fast one"
- mechanism to show: `useRequestRegion` (asyncHooks.ts) — outstanding count, sticky settled bit, last
  error, applied key, a sequence token per request; `deriveState()` (asyncState.ts) with the order
  that IS the model; the race button issues slow then fast and the ledger counts the stale drop.
- region: `InstrumentPanels.tsx` → `LedgerRegion`
- Ascent evidence: `src/components/org/followups/FollowupHistory.tsx` — union starting at `loading`,
  `cancelled` flag, error ≠ empty (grep: `rg "useState<.*\"loading\"" src`, `rg "settled" src` →
  `fleetMapDerive.ts` `settled = loaded + errored`)
- deviation: state hand-maintained per component; no shared derivation, no refreshing state
- applications read: react--state-model.md — the `isFetching && rows.length === 0` conjunct and the
  branch-ordering form of the sticky guard; nothing cited as Ascent's

### placeholder-design
- use_when matched: "skeleton flashing on fast or cached loads"
- mechanism to show: permanent chrome; `GhostRows` in the same `ROW` class/height as content, seeded
  widths, `aria-hidden`; `ghostAnimation()` delays entrance by `GHOST_DELAY_MS` (imported from
  Ascent's `deferPolicy.ts`) in both modes; the network dial proves warm loads paint no ghost.
- region: `ListPanel.tsx` → `ListRegion`
- Ascent evidence: `src/components/ui/deferPolicy.ts` `QUIET_PLACEHOLDER_DELAY_MS`, `src/app/globals.css`
  `.reveal-quiet` + `ascent-hold-hidden`, `src/components/org/shell/OrgTabGap.tsx` (grep:
  `rg "reveal-quiet|QUIET_PLACEHOLDER_DELAY_MS" src`)
- deviation: `src/components/ui/PageSkeleton.tsx` ghosts chrome with no delay; `DimensionTrends.tsx`
  ghost cards skip the window
- applications read: react--state-model.md (delayed `TableGhostRows` under a permanent header)

### action-busy-states
- use_when matched: "a fast double-press submits twice"
- mechanism to show: `BusyButton.tsx` — ref disarm in the click handler, promise-tied lifetime with
  a 4s bound, spinner + label in a fixed `min-w`, `disabled` + `aria-busy`, restore in `finally`;
  per-item scope; a scripted double-press (two `click()`s in one task) → 2 presses / 1 submission;
  live region for the outcome.
- region: `QueuePanel.tsx` → `QueueRegion`
- Ascent evidence: `src/components/CopyForLlm.tsx` `inFlight` ref set in the handler, released in
  `finally`; `src/components/org/shared/recStatusUi.tsx` `aria-busy` (grep: `rg "inFlight|aria-busy" src`)
- deviation: no shared primitive; `DecisionControl.tsx` state-driven `busy`
- applications read: react--action-busy-states.md — `inFlightRef` synchronous disarm, thenable
  lifetime, width lock, the `void` fire-and-forget defect (named in the region's footnote)

### empty-state-design
- use_when matched: "user with filters sees create your first item"
- mechanism to show: five worlds, each a `drop: true` request (ghost, then settle); `emptyCause()`
  branches on the raw collection first; `EMPTY_COPY` carries a register per cause; the readout says
  `settled: false → empty not entitled` while in flight.
- region: `EmptyPanel.tsx` → `EmptyRegion`
- Ascent evidence: `src/components/EmptyState.tsx`; `FollowupsTab.tsx` copy (grep:
  `rg "EmptyState|No .* yet" src`)
- deviation: cause is not an input; no raw-vs-filtered discriminator anywhere
- applications read: none for this technique

### failure-states
- use_when matched: "a failed refresh blanks content the user still had"
- mechanism to show: `FAILURE_COPY` one mapping; `role="alert"` failure block with Retry as a
  `BusyButton` over the reissued request; unauthorized → sign-in, no retry; escalation after two;
  held rows + failed refresh → rows stay, ambient "as of Ns ago" from the region's age clock;
  `failures` = reported counter.
- region: `FailurePanel.tsx` → `FailureRegion`
- Ascent evidence: `src/components/org/followups/FollowupHistory.tsx` retry via nonce, `role="alert"`;
  `src/components/report/DimensionTrends.tsx` error → `EmptyState` + Retry + AbortController (grep:
  `rg "onRetry|Retry\b" src`)
- deviation: every failure offers Retry; no staleness statement; raw `text-orange-300`
- applications read: react--state-model.md — `table-no-error-state` (a failed fetch renders the
  settled empty) as the negative to avoid

### arrival-choreography
- use_when matched: "settled content animating on a warm load" / "deciding which load edge plays the cascade"
- mechanism to show: `entering = arrival && !reduced && !seen.has(id)` decided during render;
  `riseAnimation(i)` 160ms/40ms/cap 8; seen-set written by delegated `animationend` and on commit
  for settled rows; reset only in `search()`; poll / resort / page turn tagged so nothing enters.
- region: `InstrumentPanels.tsx` → `ArrivalRegion` (the rows it reads live in `ListRegion`)
- Ascent evidence: `src/app/globals.css` `.stagger-children`; `src/components/org/shell/OrgTabChunks.tsx`
  `key={tab}` (grep: `rg "stagger-children" src`)
- deviation: mount-coupled; no identity guard
- applications read: react--state-model.md — `resolveRowReveal` coupling the ripple to `isLoading`
  and `useRevealTracker` as a ref-backed per-id set that survives virtualized unmount

### windowing-vs-identifying-keys
- use_when matched: "deciding whether a key change may keep the previous content on screen"
- mechanism to show: `KEY_CLASS` declared once; handlers apply the consumer table one way
  (`search()` resets page/scroll/seen-set/settled; `turnPage()`/`resort()` keep rows, never touch
  the term); `windowKey` recorded at issue time on the input side; `superseded` = live window ≠
  applied window, dims the content region.
- region: `InstrumentPanels.tsx` → `KeysRegion`
- Ascent evidence: `src/lib/org/orgTabs.ts` `TAB_SCOPED_PARAM_KEYS` + `buildOrgTabUrl()` (grep:
  `rg "useDeferredValue|keepPreviousData|setPage\(1\)" src` → 0 hits; `rg "TAB_SCOPED_PARAM_KEYS" src`)
- deviation: no list keeps previous content across a windowing change; classification exists for
  URL params only
- applications read: react--windowing-vs-identifying-keys.md — the "params bag" seam, the backwards
  one-directional rule, the rendering test it names as the missing instrument (this scene's
  behaviour test is that instrument, for the fixture)

## Out of the read

- Retention beyond the surface's lifetime (warm remount from a module cache): the scene remounts per
  volume by design and has no navigation; the golden path's rule is stated in the ledger prose only.
- Automatic bounded retries with backoff: the alerts region escalates copy after two manual failures
  but does not retry below the surface (a timer loop would be an unprompted loop in a showcase).
- Live-region announcements for region loading transitions: the queue announces action outcomes;
  the list regions expose `aria-busy` only.
- Optimistic updates with rollback: a different bargain, not shown.
