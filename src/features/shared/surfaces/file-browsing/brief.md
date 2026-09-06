# File browsing - showcase brief

subject: file-browsing
subcategory: data-display
digest: sha256:ae56dce70c40004c
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/data-display/file-browsing/file-browsing.md

## Scene concept

A **vault browser** over a fictional knowledge registry (`knowledge/`, `skills/`, `practices/`,
`memory/`, `assets/`) — a hierarchical store the surface does not own and that a "sync agent" (the
other window) keeps writing to without telling the view. The tree and trail, the kind chips, the
windowed directory listing, the bulk bar, the rename/move/trash bench and the preview panel are the
natural regions of one workbench; a viewer can navigate, select, trash, restore and preview for a
minute without knowing it is a showcase. `volume` sizes the store (most leaves land in `assets/`,
rendered through a 40-row window over a complete in-memory listing); `reduced` comes from props and
only gates the two framer entrances (bulk bar, bulk report) — every region renders its full content
under reduction and nothing loops.

## Techniques (rail order = golden path order)

### listing-and-refresh
- use_when matched: "empty and unreadable look identical on screen"
- mechanism to show: `listDir` under a printed contract (shallow, 40-row window, dot-files excluded,
  containers first, identity tiebreak); per-entry skip-and-count with disclosure; `status` spells
  `empty` / `unreadable` / `missing` differently; the listing carries the store tick it was read at,
  "sync agent writes" mutates the store behind the view, the stale badge admits the window, refresh
  replaces data and reconciles selection by identity.
- region: `ListingRegion.tsx` (pure read in `store.ts`, cache + refresh in `useVault.ts`)
- Ascent evidence: `src/lib/registry/index-walk.ts` (`cappedReader`, `selectArtifacts` — caps
  reported as warnings, unreadable blobs become warning + null) and `src/lib/registry/read.ts`
  (`truncated` disclosed on the tree and the commit list). grep: `rg "truncated" src/lib/registry`
  -> 12 hits; `rg "cappedReader" src` -> index-walk.ts.
- deviation: indexer-side only; no client listing keeps a "read at" marker.
- applications read: none for this technique in the index.

### navigation-state
- use_when matched: "expanded folders land on the wrong nodes after restore"
- mechanism to show: `NavState` as one object serialized to one blob on every change (shown live in a
  `<pre>`); `hydrate` re-expands surviving identities, drops vanished ones, relocates a vanished
  location to the nearest surviving ancestor via the saved path and reports it; tree and trail render
  the same `nav.location`; trail collapses its middle; "reset view" door; selection and scroll not in
  the blob.
- region: `NavRegion.tsx` (pure serialize/hydrate in `navState.ts`)
- Ascent evidence: `src/features/inflight/live/outcome/useColumnWidths.ts` (one localStorage key per
  org, tolerant read, write on change). grep: `rg "localStorage" src -l` -> 6 files; the others are
  tour/session storage. Expansion sets: `rg "Set<string>" src/features/shared/knowledge` ->
  `KnowledgeLoom.tsx` `collapsed` (ephemeral). URL-scoped state: `TAB_SCOPED_PARAM_KEYS` in
  `src/lib/org/orgTabs.ts`.
- deviation: no navigation-state object in Ascent; expansion is ephemeral; nothing reconciles a
  restored value against live data.
- applications read: `react--navigation-state.md` — mechanisms taken: one JSON blob under one key
  with tolerant read and merge-write; persist on change with lazy hydration; history as identities;
  selection and kind filter reset on navigation; warm return caches are session-scoped. Its file paths
  and line numbers are that repo's, cited nowhere as Ascent's.

### selection-model
- use_when matched: "choosing select-all scope when the listing is windowed"
- mechanism to show: `useSelection` — a set of identities + anchor + focus; click/toggle/range
  grammar with range resolved in visual order at the gesture; `selectLoaded` (materialized, says
  "loaded") vs `selectMatching` (a predicate + exclusion list resolved by the store at fire time);
  `reconcile` intersects by identity after refresh and counts the dropped; the bulk bar derives count,
  predicate and the exact id list; navigation clears.
- region: `SelectionRegion.tsx` (rows in `ListingRegion.tsx` fire `sel.click`)
- Ascent evidence: `src/components/org/followups/FollowupsWorklist.tsx` (`selected: Set<string>` of
  follow-up ids driving bulk done/dismiss). grep: `rg "useState<Set<string>>" src` -> Followups,
  SecurityFindingsTable (filters), KnowledgeLoom.
- deviation: no anchor/range, no identity reconcile against a refetch, no predicate select-all.
- applications read: none for this technique in the index.

### file-mutations
- use_when matched: "a bulk move summary says only done"
- mechanism to show: advisory `preflightRename` + typed `Verdict` at fire time, each rendered as its
  own sentence, failure refreshes the view; `planMove` as the one guard door for move-to and trash
  (onto-itself, into-own-descendant, root); `executeMove` per item with a chosen conflict policy
  (skip / keep-both naming the result / replace stating the loser); the report "N of M — K failed"
  with enumerated failures and a retry of only those; soft delete with origin, restore, and a named
  reaper (`TRASH_CAP`); pessimistic commit.
- region: `MutationsRegion.tsx` (pure ops in `mutations.ts`, commit in `useVaultMutations.ts`)
- Ascent evidence: `src/app/api/practices/apply-batch/route.ts` (bounded fan-out, per-repo error
  ownership, `{ results: [{ repo, ok, error? }], attempted, skipped }`). grep: `rg "attempted" src/app/api/practices`.
- deviation: PR-shaped mutations; no trash, no conflict policy, no shared guard door.
- applications read: none for this technique in the index.

### thumbnails-and-previews
- use_when matched: "stale thumbnail after the file changed"
- mechanism to show: `KINDS[kind].maxRung` ceiling + `rungFor` (highest rung READY; a failed
  thumbnail leaves the icon); `PreviewCache` keyed `id@v<version>` with cached failures, a budget of
  24 and LRU eviction, stats on screen; decode only for images in the mounted window (≤ 8 tiles);
  "rewrite bytes" bumps the version and invalidates by construction; inline text previews for
  document/data; focus reconciled by identity so a vanished file's preview closes on refresh.
- region: `PreviewRegion.tsx` (pure cache in `previewCache.ts`)
- Ascent evidence: `src/components/org/shell/OrgTabErrorBoundary.tsx` (per-panel boundary keeping
  the shell alive). grep: `rg "getDerivedStateFromError" src -l` -> OrgTabErrorBoundary,
  ReportErrorBoundary. Lazy-near-viewport: `src/components/ui/deferPolicy.ts` (`visible`, 240px
  root margin). Version-keyed derivation: `src/lib/org/surface-freshness.ts` compares digests but
  caches nothing.
- deviation: no derived-image cache, no failure cache, no budget.
- applications read: `react--thumbnails-and-previews.md` — mechanisms taken: three-way tile branch
  (loaded image / placeholder / kind-icon floor), a background reload never hides assets already on
  screen, a heavy viewer behind its own error boundary with the file still actionable, the named gap
  that thumbnail failure was not cached (this scene caches it). Its paths cited nowhere as Ascent's.

### kind-taxonomy
- use_when matched: "explaining files that vanished behind an old filter"
- mechanism to show: `KIND_ORDER` / `KINDS` / `classify` as the single authority for glyphs, chips,
  `kindRank` sorting, rung ceilings and counts; chip counts under the current folder and a banner
  that says so; stranded filters disclosed; containers first whatever the key; tokens persisted as
  identifiers and unknown ones dropped with a count on hydrate; the vocabulary table as audit.
- region: `KindsRegion.tsx` (vocabulary in `kinds.ts`)
- Ascent evidence: `src/lib/org/surface-catalog.ts` (`SURFACE_SUBCATEGORIES` as one closed
  vocabulary the gallery, records and bijection test derive from). grep: `rg "SURFACE_SUBCATEGORIES" src`.
  Also read: `src/lib/registry/taxonomy.ts` (the registry's taxonomy as the authority on placement).
  File-kind classification: `rg "endsWith\(\"\." src/lib/analyze` -> inline per detector in
  `tech-extract.ts`.
- deviation: file kinds are inline judgment calls per detector, not one vocabulary.
- applications read: none for this technique in the index.

## Out of the read

- Keyboard traversal of the tree and list (arrows, type-ahead) and rename-in-place inside the row:
  the accessibility posture of the golden path; the scene offers Enter/Space on rows and a labelled
  rename input instead, to stay under the LOC cap.
- Drag-and-drop between containers: the drag-drop subject owns the interaction; the scene shows the
  keyboard-and-menu equivalent ("move to").
- Watch-versus-poll refresh: the scene has no clock (no always-on loop by rule); the sync agent is a
  button, so the refresh strategy shown is opportunistic + manual and the window is stated.
- Cancellation of long bulk runs and a streamed listing: the store is in memory and synchronous.
- Name search over the corpus: the search subject's.

## Gates run

`npx tsc --noEmit` (one pre-existing error in the gitignored `.next/dev/types/validator.ts`, not
this scene's) · `npx vitest run src/features/shared/surfaces src/lib/org` · LOC check (≤200 under
`src/features/**`) · `Scene.dom.test.tsx` (jsdom: regions, reduced path, every volume, empty vs
unreadable, stale + reconcile, typed verdict, guard door + per-item report + restore, hydrate +
relocate, stranded filter, cached failure + version invalidation).
