# Search - showcase brief

subject: search
subcategory: data-display
digest: sha256:54682051824eb2b3
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/data-display/search/search.md

- **Read:** the golden path, all seven techniques (`query-parsing`, `full-text-indexing`,
  `ranking-and-excerpts`, `faceting-and-filters`, `saved-views`, `command-surface`,
  `typed-filter-language`), the three applications (`react--command-surface`,
  `rust--full-text-indexing`, `cpp--typed-filter-language`), and the cited laws
  (`one-validation-door`, `failure-not-empty-success`, `one-authority-per-vocabulary`,
  `identity-survives-reuse`, `count-carries-predicate`, `derivation-names-recomputation`,
  `gate-sees-target`, `creation-names-reaper`, `verdict-survives-boundary`).
- **Rule said out loud:** a bundle states the standard; the repo may deviate, but a deviation is
  recorded, never silent. Applications are other repos: mechanisms and numbers transfer, paths do not.

## Scene concept

A fleet search over a fictional corpus of repositories (`fixtures.ts`, seeded, `volume` rows) whose
one text box is honestly the subject's three intents — search, filter, navigate — with every stage of
the pipeline visible: the query door reflects its parse as chips and labels the ladder rung, the
inverted index (or scan) is kept honest against its source, results come in a total order with
engine-derived excerpt marks, facets carry their predicate, saved views validate against the live
schema, a command palette runs on the scene's one registry, and a rule box types a predicate before it
runs. A viewer can use it as a product surface — type, pick facets, apply a view, summon the palette —
and the rail is what reveals the techniques. Everything is synchronous and local (no request
sequencing to show; the `async-ui-states` scene owns that), so nothing animates: `reduced` is
accepted and threaded for the contract; `volume` sizes the corpus and the window stays one page.

## Techniques

### query-parsing
- use_when matched: "turning raw user text into an engine-safe query"; also "zero results that could be failure or true emptiness"
- mechanism to show: `parse.ts` is the one door (balanced quotes, `field:value` from SCHEMA lifted into typed clauses, unknown prefix kept literal and named, `MIN_TOKEN` 2 / `MAX_TERMS` 12 refused and reported); `runLadder` in `search.ts` descends only on empty and names its rung; a simulated outage is a `failure` kind with retry
- region: `SearchBox.tsx`
- Ascent evidence: `src/lib/db/org-memory.ts` (`listOrgMemories` composes the raw search as Prisma `contains … mode: "insensitive"` over three named fields — literal, no engine syntax reachable) (grep: `rg 'mode: "insensitive"|contains:' src/lib/db`)
- deviation: matching policy re-derived per call site — `RegistryRepoPicker.tsx:62`, `useRepoSegmentsPanel.ts:50`, `followupsModel.ts:140`, `SecurityFindingsTable.tsx:81` each `toLowerCase().includes` inline (grep: `rg "toLowerCase\(\)\.includes" src`), no diacritic fold (grep: `rg 'normalize\("NFD"\)' src` → 0 hits outside this folder), no prefixes, no labelled degradation, empty and failed alike
- applications read: `rust--full-text-indexing.md` — the tokenize-then-quote door with both bounds (min token length 2, cap 12 terms) and the "all-noise input is empty success" shortfall; numbers reused, nothing cited as Ascent's

### full-text-indexing
- use_when matched: "matches resolving to deleted rows"; also "choosing what the tokenizer throws away"
- mechanism to show: `tokenize.ts` (one fold, one split; toggles for diacritics and identifier humps shown on two pinned names), `buildIndex` with its own `docIds`, the scan as the same `Engine` type timed beside it, the sync/grow posture (grow lags deletions → ghost hits counted), the drift check reading the index's own storage with `!=`, and `rebuild` as the named recomputation
- region: `IndexPanel.tsx`
- Ascent evidence: `src/lib/db/org-skills.ts` (`listOrgSkills` — Prisma `contains` scan over name + description; declared scope, correct posture at this size); `prisma/schema.prisma` carries relational `@@index` only (grep: `rg "@@fulltext|tsvector|fts5" prisma src` → 0 hits)
- deviation: no full-text index or tokenizer exists anywhere; every search is a substring scan
- applications read: `rust--full-text-indexing.md` — external-content index, sync triggers + boot reconciliation, "count the shadow table, not the query interface", `!=` not `<`; mechanisms reused, no path cited

### ranking-and-excerpts
- use_when matched: "highlighter misses the inflected form the engine matched"; also "result order shimmers between identical queries"
- mechanism to show: `rank.ts` — written-down score (field weights from the index schema, saturating length-normalized tf, rarity), total order (score, updatedAt, id), bands not numbers, `excerpt` windowed on the densest cluster with marks from `hit.matched` (prefix-expanded), composed as text segments; a readout counts engine marks against a whole-word re-find of the typed text
- region: `ResultsPanel.tsx`
- Ascent evidence: `src/components/org/followups/followupsModel.ts` (`sortByValue` — value rank, projected points, then `title.localeCompare` as the final key) (grep: `rg "localeCompare" src`)
- deviation: no surface ranks by relevance or shows an excerpt/mark; a row's reason for appearing is never shown
- applications read: `rust--full-text-indexing.md` — `bm25()` order with a recency tiebreak, `snippet(...)` from what the engine matched, "no unique final tiebreaker" shortfall

### faceting-and-filters
- use_when matched: "choosing which selection each facet count assumes"; also "page 2 of the filtered list comes back empty"
- mechanism to show: `facets.ts` — four facets from SCHEMA, `passes(row, predicate, lift)` for the disjunctive count, OR within / AND across, clauses from the text box folded into the same predicate (`withClauses`), the default exclusion as a removable chip, `isNarrowed` against the default, `setPredicate` resets the page, zero-count disabled-visible, a disclosure line naming the set the counts cover
- region: `FacetPanel.tsx`
- Ascent evidence: `src/components/org/SecurityFindingsTable.tsx:69-100` (options from the FULL row set; `withReset` re-opens the window at page one on any filter change) (grep: `rg "clear filters|filtersActive|ScopeFilterBar" src`)
- deviation: no counts anywhere; `filtersActive` (`followupsModel.ts:152`) tests emptiness, not the default; `ScopeFilterBar` has no chip row
- applications read: none for this technique in the index

### saved-views
- use_when matched: "a retired filter clause quietly widens results"; also "deciding whether a view re-runs or freezes results"
- mechanism to show: `views.ts` — `toStored` (typed clauses as plain arrays), `validateView` against the live SCHEMA at apply, `mintViewId` (identity survives rename), `isDirty` against the applied snapshot; `ViewsPanel.tsx` renders the dead `tier` clause of the 2025 view, withholds results, offers repair, and the three exits
- region: `ViewsPanel.tsx`
- Ascent evidence: `src/lib/org/orgTabs.ts:291` (`TAB_SCOPED_PARAM_KEYS`, `buildOrgTabUrl`, `clearedTabScopedParams` — navigational state in the URL, the graduated form below a named view) (grep: `rg -i "savedView|saved view" src` → 0 hits)
- deviation: no named views; filter sets live in component state and die on navigation
- applications read: none for this technique in the index

### command-surface
- use_when matched: "scoring fuzzy matches so initials outrank substrings"; also "deciding whether history may override a text match", "palette matches everything at three characters"
- mechanism to show: `palette.ts` — subsequence matcher scored by shape (boundary/hump 10 vs interior 2, consecutive +6, gap penalty, prefix +20, coverage), `FLOOR` 12 with a rejected count, order = score → session ledger → stable id, empty query lists the ledger; `PalettePanel.tsx` — the scene's one `commands` registry (the action strip renders it too), a bounded labelled repository section (200 most recently updated), arrows/enter/escape
- region: `PalettePanel.tsx`
- Ascent evidence: none found (grep: `rg -i "command palette|cmdk|CommandPalette" src` → 0 hits)
- deviation: no palette, no keyboard-summoned navigation; `ORG_NAV_GROUPS` is the registry one would derive from
- applications read: `react--command-surface.md` — one registry by derivation, banded scoring (exact 100 / prefix 90 / substring 80 / subsequence), field weights, session ledger capped at 5, and the "score-only sort, no explicit tiebreak" shortfall; the explicit tiebreak is what this scene adds; no path cited

### typed-filter-language
- use_when matched: "deciding whether an ill-formed rule should be rejected or coerced"; also "a saved rule fails only when a matching item finally arrives"
- mechanism to show: `rules.ts` — lexer with spans, recursive-descent parser, bottom-up `typeOf` over a closed type set with `TYPING_CONTEXT` as the static twin of the row, per-operator typing rules (equality closed, no coercion), a bool root contract, a verdict carrying the offending span; `ruleTable.ts` is the validity table (rendered live in `RulesPanel.tsx`, asserted in `rules.test.ts`); persisted rules pass the same door at load and the retired-`tier` rule is marked broken with its lane empty
- region: `RulesPanel.tsx`
- Ascent evidence: none found (grep: `rg "parseRule|filterExpression|synthesizeType" src` → 0 hits; `src/lib/org/stance.ts` `evaluateStanceCompliance` is a declared policy evaluated by fixed code, not a user-authored expression)
- deviation: no user-authored predicate language exists
- applications read: `cpp--typed-filter-language.md` — parse then `synthesizeType`, `IllTyped` pointing at the node, "Expected Bool but got String", "Problem occurred here:" with the subexpression, fail-closed on an invalid rule, retire-as-constant; mechanisms and message shapes reused, no path cited

## Out of the read

- Request sequencing / never-blank-while-in-flight (golden path "latency budget"): everything here is
  synchronous; the `async-ui-states` scene's repository search owns it.
- Index-lag staleness disclosure: the scene's index rebuilds synchronously except under the "grow"
  posture, which is shown as drift/ghosts rather than as time lag.
- Shared-view ownership semantics beyond "shared views fork on edit" (save-as): no multi-user state
  in a fixture scene.
- Hierarchical facets (exactly-at vs at-or-under): the schema has no tree.

## Gates run

`npx tsc --noEmit` (clean; the gitignored `.next/dev/types/validator.ts` error is a dev-server
artifact) · `npx vitest run src/features/shared/surfaces src/lib/org` (69 files, 1003 tests green;
`Scene.dom.test.tsx`, `engine.test.ts`, `rules.test.ts` in this folder) · the 200-LOC check under
`src/features` (nothing printed; `rules.ts` is at 200). Observation (headless Chromium screenshot)
is the Director's step in builder mode: not observed by this run.
