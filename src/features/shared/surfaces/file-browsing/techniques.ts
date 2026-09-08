// The drawer entries for the file-browsing scene: one per technique of the registry's `file-browsing`
// subject (authored against sha256:ae56dce70c40004c, 2026-09-06), in the golden path's order.
// `mechanism` explains what the region does; `source` is the scene's own code; `inAscent` cites a
// real Ascent file that was read; `deviation` names where the scene or Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "listing-and-refresh",
    title: "Listing and refresh",
    mechanism:
      "`listDir` is the one reader and its contract is printed in the region: one directory, shallow, a 40-row window over a complete in-memory listing, dot-files excluded by a declared policy, containers first with an identity tiebreak. " +
      "Error policy is per entry: an unreadable file is skipped, counted and disclosed as 'could not read N', while an unreadable directory returns `status: \"unreadable\"` and an empty one `\"empty\"` — the two zero cases render different sentences. " +
      "The listing carries the store tick it was read at; the 'sync agent writes' button mutates the store without telling the view, and the badge flips to stale — the staleness window is admitted, not hidden. " +
      "Refresh replaces the data and reconciles the selection and expansion by identity, so the honest act never costs the session. " +
      "The store's own mutations re-list pessimistically; navigation re-lists opportunistically.",
    source: S.SRC_LISTING,
    inAscent: {
      file: "src/lib/registry/index-walk.ts",
      note: "`selectArtifacts` and `cappedReader` read the registry tree under declared caps and turn every unreadable or oversized blob into a warning plus `null` — skip-and-count, never abort, never silently short (`read.ts` reports `truncated` for the same reason).",
    },
    deviation: "Ascent's reads are indexer-side; no client listing keeps a 'read at' marker, so a stale panel and a current one look the same until the next index pass.",
  },
  {
    slug: "navigation-state",
    title: "Navigation state",
    mechanism:
      "`NavState` is one object — location, expansion set, sort, filter tokens — and `serialize` writes it as one JSON blob on every change (the `<pre>` shows the live blob), never on exit. " +
      "The expansion set holds folder identities; `hydrate` on 'simulate restart' re-expands the ones that still exist, drops the ones the store removed, and if the saved location is gone walks the saved path up to the nearest surviving ancestor and says so in the restore readout. " +
      "The tree and the trail both render `nav.location`, so they cannot point two directions; the trail collapses its middle under width pressure and keeps root and current. " +
      "Selection and scroll are deliberately absent from the blob. " +
      "'reset view' is the cheap door out of a drifted map, and unknown blob fields degrade to defaults rather than to amnesia.",
    source: S.SRC_NAV,
    inAscent: {
      file: "src/features/inflight/live/outcome/useColumnWidths.ts",
      note: "Persists the sheet's viewer state per org in one localStorage key, read inside try/catch and clamped on the way in, so a corrupt or missing value degrades to defaults — the tolerant, per-root, write-on-change half of the technique.",
    },
    deviation: "Ascent has no navigation-state object: expansion sets (`KnowledgeLoom`'s `collapsed`) are ephemeral `useState`, tab-scoped params live in the URL (`TAB_SCOPED_PARAM_KEYS`), and nothing reconciles a restored value against live data.",
  },
  {
    slug: "selection-model",
    title: "Selection model",
    mechanism:
      "`useSelection` holds a set of identities plus an anchor and a focus (identities too); plain click replaces, Ctrl/⌘ toggles and moves the anchor, Shift resolves anchor→target in the window's visual order at that instant and stores the span as ids. " +
      "The bulk bar derives everything from the set: the count, its predicate ('N identities of 40 loaded' or 'everything matching minus K excluded'), and the exact id list the next mutation receives. " +
      "Against the windowed listing 'select all loaded' materializes the window and says so; 'select all matching' is a predicate plus an exclusion list that `resolveTargets` resolves against the live store at fire time — the partial universe is never called everything. " +
      "After a refresh the set is intersected with the new listing by identity and the 'dropped since aim' readout climbs, visibly, when a selected item vanished. " +
      "Navigation clears the selection: armed intent does not travel.",
    source: S.SRC_SELECTION,
    inAscent: {
      file: "src/components/org/followups/FollowupsWorklist.tsx",
      note: "`selected` is a `Set<string>` of follow-up ids driving the bulk done/dismiss actions — identity-keyed, one producer feeding the bulk bar and the mutation.",
    },
    deviation: "No Ascent selection carries an anchor or a range gesture, none is reconciled against a refetch by identity, and select-all is always the loaded page — there is no predicate selection over an unloaded universe.",
  },
  {
    slug: "file-mutations",
    title: "File mutations",
    mechanism:
      "`preflightRename` runs live as you type and is labelled advisory; `rename` re-validates against the store at fire time and returns a typed `Verdict` — gone, name-taken, root, read-only — each rendered as its own sentence, and a failure refreshes the view because it is evidence the view was stale. " +
      "Move-to and trash both build their operation list through `planMove`, the one guard door that refuses onto-itself, into-own-descendant and the root before the store is asked. " +
      "`executeMove` applies each op independently and reports per item: 'moved 12 of 15 — 3 failed' with the failures enumerated and a retry that re-fires only them; conflicts follow a policy the user chose (skip, keep-both with the resulting name, replace stating the loser). " +
      "The trash is a soft delete with `origin`, a restore, and a reaper named beside it (`TRASH_CAP`, oldest first). " +
      "Every write commits pessimistically: the store answers, then the listing is retaken.",
    source: S.SRC_MUTATIONS,
    inAscent: {
      file: "src/app/api/practices/apply-batch/route.ts",
      note: "The fleet rollout fans out with bounded concurrency, lets each repo own its errors so one failure never aborts the pool, and returns `{ results: [{ repo, ok, error? }], attempted, skipped }` — a bulk mutation reported per item with a count that carries its predicate.",
    },
    deviation: "Ascent's mutations are PR-shaped, so there is no trash, no conflict policy and no guard door shared by several surfaces; the batch route's dedupe and cap are the closest thing to a structural refusal.",
  },
  {
    slug: "thumbnails-and-previews",
    title: "Thumbnails and previews",
    mechanism:
      "The ladder is explicit: `KINDS[kind].maxRung` is the ceiling and `rungFor` picks the highest rung READY — a corrupt image falls back to its kind icon (rung 1), never a hole, while the row stays selectable, renamable and trashable. " +
      "`PreviewCache` is keyed on `id@v<version>`, so 'rewrite bytes' (or the sync agent rewriting a file) misses by construction and the stale-thumbnail bug cannot exist; failures are cached with the same key so a corrupt file is not re-decoded every pass. " +
      "The cache names its reaper at construction — a budget of 24 with LRU eviction — and the readouts show hits, misses, cached failures, residents and evictions. " +
      "Only images inside the mounted window decode (`vault.visible`, at most eight tiles): a 50,000-entry folder triggers no decode storm. " +
      "Documents and data preview inline from deterministic text; the panel for a vanished file closes on the next refresh because focus is reconciled by identity.",
    source: S.SRC_PREVIEWS,
    inAscent: {
      file: "src/components/org/shell/OrgTabErrorBoundary.tsx",
      note: "A per-panel boundary that contains one tab's render crash so the header, rail and tour survive and the user can act elsewhere — the blast-radius rule the technique demands per tile and per viewer.",
    },
    deviation: "Ascent has no derived-image cache; the nearest cached derivation, `surface-freshness.ts`, keys on a subject digest but caches nothing, and `Defer strategy=\"visible\"` defers mounting near the viewport without a budget or a failure cache.",
  },
  {
    slug: "kind-taxonomy",
    title: "Kind taxonomy",
    mechanism:
      "`KIND_ORDER` and `KINDS` in kinds.ts are the single authority: the row glyph, the chips, the sort-by-kind comparator (`kindRank`), the preview ceiling and the per-kind counts all derive from them, and `classify` is the one classifier, keyed on the extension token and honest that `other` is a real bucket. " +
      "Chip counts are computed under the current folder and the banner says so; an active filter is visible from across the room, and a filter whose bucket has no members in scope is marked stranded instead of leaving a silent empty view. " +
      "Containers sort before leaves whatever the active key. " +
      "Tokens persist in the nav blob as identifiers; `hydrate` drops a token the vocabulary no longer knows and reports it, so renaming a kind cannot orphan saved state. " +
      "The vocabulary table at the bottom is the drawer's audit: token, rank, glyph, ceiling, signal.",
    source: S.SRC_KINDS,
    inAscent: {
      file: "src/lib/org/surface-catalog.ts",
      note: "`SURFACE_SUBCATEGORIES` / `SurfaceSubcategory` is one closed vocabulary that the gallery filter, the catalog records and the bijection test all derive from — a token set with one definition and enumerable consumers.",
    },
    deviation: "Ascent classifies files nowhere as a vocabulary: `tech-extract.ts` asks 'does the path end with…' inline per detector, so a new kind is a sweep across detectors rather than one edit.",
  },
];
