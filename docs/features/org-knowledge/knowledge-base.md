# Knowledge base — the registry's knowledge lane, and the fleet against it

**Status: CURRENT** (rebuilt 2026-09-05, spark `knowledge-base-rebuild`; the Loom direction won the
prototype round over Atlas and Board. Context rows and churn added 2026-09-06, spark
`knowledge-context-matrix`. Aligned to the shared /org visual kit 2026-09-08, Wave 3 of
[ORG-UX-REDESIGN](../../ORG-UX-REDESIGN.md).)

Org dashboard tab `?tab=knowledge`, last in the **Shared** group. It shows the org's registry
knowledge lane **as the registry structures it** — bundle (domain) → category → subcategory →
subject, from each bundle's own generated `index.json` and `taxonomy.json` — and **how the fleet
stands against it**: one cell per (subject × swept repo), with the registry's own six-way absence
vocabulary, plus the dispatch flow that hands a repo its next act.

Ascent never judges conformance. The consumer computes: a repo's own `/conform` writes verdicts into
its `.ai/registry-map.json`, and Ascent's sweep reads them. This tab is a mirror with a hand.

## The three use cases

| Use case | Where it lives on the tab |
| --- | --- |
| **Map the registry into Ascent** — see the corpus as the registry lays it out | the row labels: categories and subcategories in the taxonomy's declared order, subject slugs verbatim; the subject reader (`use_when` triggers, laws, status, technique count, the golden path's real file path, a link into the registry repo, and — when the subject has a showcase — an `Open showcase →` link into `?tab=surfaces&subject=<slug>`; see [surfaces.md](surfaces.md)) |
| **Map Ascent projects into the registry** — scan → map → conform | the "off the loom" strip (repos with no map and their next act), the dispatch composer, the hand-off ledger; see [Dispatch](../org-registry/README.md#dispatching-a-registry-stage-to-a-repo) |
| **Domain matrix** — which projects consume which topics of a domain | the loom itself: every subject of the selected bundle × every mapped repo |

## Surfaces

| Path | Role |
| --- | --- |
| `src/features/shared/knowledge/KnowledgeTab.tsx` | server tab; reads `?domain=` and `?subject=`; unmapped / error / empty notices; the dev-only preview shell |
| `KnowledgeLoom.tsx` (+ `KnowledgeLoomGrid.tsx`) | the client orchestrator and the matrix |
| `KnowledgeCoverage.tsx` | **first sight**: the bundle coverage matrix (Mirrored × Routable × Judged, one row per bundle) |
| `KnowledgeStateLegend.tsx` | the legend — each row is the kit's `StateSwatch` under the domain glyph |
| `KnowledgeImpactBars.tsx` | the subject reader's blast-radius bars, one per mapped repo |
| `knowledgeViz.ts` | the epistemic derivations: `bundleCoverage`, `subjectVizState`, `subjectImpact` |
| `KnowledgeRepoBadges.tsx` | the column-header churn badges (`N orphaned`, `M new`, `map behind`), rendered only when non-zero / true |
| `KnowledgeComposer.tsx` | the dispatch composer + the hand-off ledger |
| `KnowledgeComposerContexts.tsx` | under the picked-subject chips: each subject's revision header and its context rows in the picked repo; the map-behind line with its map-stage brief |
| `KnowledgeSubjectDetail.tsx` | the subject reader (a `Modal`); footer deep-links to the UI surfaces showcase when `isSurfaceShowcased(slug)` |
| `KnowledgeSubjectImpact.tsx` | the reader's "Impact" section: revision line, contexts-across-repos total, and the subscribed contexts by name per repo (folded past 6) |
| `KnowledgeShared.tsx` | `CellButton` (glyph + context count on judged cells), `StateLegend`, `StageChip`, `Spectrum`, `SweepStrip`, `DomainPicker` |
| `knowledgeModel.ts` / `knowledgeVocabulary.ts` | pure derivations; labels, glyphs and tones for the eleven states and four stages |
| `useKnowledgeSelection.ts` | domain / focused subject / picked cells; URL sync |
| `useKnowledgeActions.ts` | the one client call path for sweep, compose-brief, run-local |
| `KnowledgePreviewShell.tsx` | dev-only shaped-fleet preview (`registryPreviewEnabled()`, unmapped only, actions inert) |
| `src/lib/org/knowledge-shape.ts` | the client-safe wire contract (`KnowledgeView`, `KnowledgeCell`, `RegistryDispatchRow`, …) |
| `src/lib/org/knowledge-view.ts` (+ `knowledge-fleet.ts`) | the server loader; the dense subject × repo fold |
| `src/lib/org/knowledge-view.fixture.ts` | the shaped fixture — the real software-engineering taxonomy (52 of 214 subjects) over an eight-repo fleet reaching every state and stage; every judged cell carries deterministic context rows, subjects carry revisions, and three repos carry churn (`r-api` orphaned + renamed, `r-billing` arrived, `r-infra` map behind) |
| `src/lib/registry/absence.ts` | `classifyAbsence` (a verbatim port of the registry's `build-fleet-map.mjs` rule) and `repoStage` |
| `src/lib/registry/conformance-fold.ts` | worst-wins fold of a subject's judged pairs; `stale` |
| `src/lib/registry/taxonomy.ts`, `conformance-foundation.ts` | the indexer's taxonomy mirror; the sweep's manifest / directions / context-map readers |

The Registry tab keeps onboarding, sync and index health and points here (`RegistryKnowledgePointer`);
it renders no subject-level panel of its own. (`KnowledgeLedger.tsx`, the pre-Loom ledger, was
deleted on 2026-09-06 — nothing imported it since the rebuild.)

## The cell vocabulary

Eleven states, closed (`KNOWLEDGE_CELL_STATES`). The first four are the repo's OWN verdicts; the
rest are absences, classified in the registry's order, first match wins:

| State | Meaning | Glyph |
| --- | --- | --- |
| `conformant` / `deviation` / `not-applicable` | a `/conform` verdict, folded worst-wins across the repo's contexts | `•` / `▮` / `◦` |
| `unknown` | the matcher paired them, nobody judged (the map's `unknown`) | `—` |
| `candidate` | in domain, in scope, no decision, no context resonates — the direction backlog | `+` |
| `accepted` / `deferred` / `declined` | a direction decision in the repo's `.ai/directions/ledger.jsonl` | `↗` / `…` / `×` |
| `out-of-scope` | the manifest's `scope` block excludes the subject, its category or subcategory | |
| `out-of-domain` | the manifest does not declare the subject's bundle | |
| `no-map` | the repo has no `.ai/registry-map.json`; nothing above can be known | |

A judged cell is `stale` when the pair's `evaluatedAgainst` is not the subject's current digest
(dotted underline). Cells are dense by construction — every (subject × swept repo) has one — so an
absence is never an empty square. Tones sit off the score ramp: a deviation is a decision someone
recorded, not a failure to reach a number.

### Two axes, one canonical — `CELL_VIZ_STATE`

The eleven states above are the **domain axis**: *which* classification the registry gave this pair.
The dashboard-wide `VizState` (`@/components/org/viz`, the [redesign](../../ORG-UX-REDESIGN.md) §2.4
vocabulary) is the **epistemic axis**: did we *measure* it, was it merely *declared*, did nothing
*judge* it, is there no measurement at all. `knowledgeVocabulary.ts` maps the first onto the second,
and **the kit is canonical** — every hatch, dash, void, opacity, swatch and caveat sentence on this
tab comes from the kit through that map. Nothing in this feature directory defines one.

| Cell states | `VizState` | Why |
| --- | --- | --- |
| `conformant`, `deviation` | `measured` | a verdict `/conform` wrote against evidence |
| `not-applicable`, `accepted`, `deferred`, `declined` | `decided` | a person ruled on it (accent ring) |
| `unknown`, `candidate` | `not-judged` | hatched; never counted as passing, and prints no value |
| `out-of-scope`, `out-of-domain` | `declared` | dashed outline: the manifest declares the boundary |
| `no-map` | `missing` | a void — nothing can be known, and a void is never a zero |

Repo stages map too (`STAGE_VIZ_STATE`): `populate` → `missing` (no context map, so nothing about the
repo has been measured), `map` / `conform` → `not-judged`, `current` → `measured`. The stage chip, the
churn badges (`KnowledgeRepoBadges`) and the sweep strip all paint from it; each badge's own reason
sentence (`REASON`) rides in its `title` beside the kit's `STATE_HINT`.

`knowledgeVocabulary.CELL_REASON` holds the eleven "why this state" sentences. They are **disclosed,
never printed** — a cell's `title`, a legend row's tooltip — so the wire contract's "absence is never
zero" rule is reachable by a reader of the UI, not only by a reader of the source.

### Bundle coverage — what the tab opens on

The Knowledge base has **no per-repo adoption state** (which is why `ORG_NAV_GROUPS` puts it last in
Shared), so it draws no fleet posture. What it draws is structure — `KnowledgeCoverage`, a
`MatrixGrid` with one row per bundle:

| Axis | Measures | The absence |
| --- | --- | --- |
| **Mirrored** | subjects held as rows ÷ subjects the bundle publishes | `declared` (dashed, no numeral) when the bundle publishes subjects and no index pass resolved one; `missing` when the bundle publishes none |
| **Routable** | techniques carrying a `use_when` trigger ÷ all techniques | `missing` when the bundle has no techniques |
| **Judged** | pairs with a current verdict ÷ pairs that exist | `not-judged` (hatched) when no repo carries a registry map; `missing` when the fleet was **never swept** |

Each subject row of the loom carries its own **provenance** mark beside the label
(`subjectVizState`): `measured` when we hold the subject's digest *and* a revision, `declared` when
the registry declares it and no index pass resolved either, `missing` when its bundle is absent from
the view. The mark sits outside the row's button so the control's accessible name stays the slug.

## Context rows — what a cell folds

A judged cell is a worst-wins fold of the repo's contexts that subscribe to the subject
(`KnowledgeCell.contextRows`, one `KnowledgeContextRow` per pair, worst state first then by name;
`contexts === contextRows.length`, `[]` for every absence). Three surfaces unfold it:

- **The cell** renders `<glyph> <n>` — the count of subscribed contexts sits beside the glyph in a
  muted `tabular-nums`. Absences stay glyph-only: nothing is folded there. The stale dotted underline
  is unchanged, and the `title` is still prefixed `<repo> · <subject> — <state label>`, now with the
  kit's `STATE_HINT` and this state's `CELL_REASON` appended on their own line.
- **The composer** (`KnowledgeComposerContexts`) unfolds each picked subject under its chip: a header
  `<slug> · r<revision> · <changedAt>` (`r? · unversioned` when the index predates revisions), then one
  row per context — `<glyph> <name> — <state> · <how it was judged>`. The judged reading is one of:

  | Reading | When |
  | --- | --- |
  | `judged at r7` | the verdict was judged at the subject's current revision |
  | `judged at r5, 2 behind` | the verdict predates the subject's revision by that many |
  | `judged at ? (stale)` | a stale verdict from before revisions existed — nothing to count behind from |
  | `judged at ?` | a current verdict with no recorded revision |
  | `unjudged` | the matcher paired them and nobody judged |
  | `new` | the context arrived in this map (`arrived`); a fresh subscription nobody has judged |

  A picked subject no context subscribes to says so, and the brief asks for a direction.
- **The subject reader** (`KnowledgeSubjectImpact`) opens with
  `r<rev> · <changedAt> · <N> contexts across <M> repos · <S> stale`, then **draws** the magnitude —
  one bar per mapped repo, length = subscribed contexts, painted from that cell's `VizState`
  (`KnowledgeImpactBars`) — then lists the subscribed contexts **by name** per repo, each with its
  state glyph (stale names dotted), folded past six with a `+k more` toggle. A count names nothing
  actionable; the context name is where the golden path is read next.

  **An unmeasured impact prints no number.** `subjectImpact` returns `null` counts — never `0` — when
  the fleet was never swept or no repo carries a registry map, and the panel renders the kit's void
  or hatch with `impact not measured` and a `WhyChip`. The panel used to print
  `0 contexts across 0 repos · 0 stale` in both of those situations *and* for a subject nothing
  genuinely subscribes to, which read as three identical zeros for three different facts.

## Churn — what moved between sweeps

Each `KnowledgeRepo` carries `orphaned` (verdicts whose context vanished from `context-map.json`),
`arrived` (contexts absent from the previous map), `renamed` (contexts re-attached by path overlap),
and `mapBehind` with the pair `contextMapRevision` → `repoContextMapRevision` (the registry map was
built against an older context map than the repo has now; false when either revision is unknown).

- **Column headers** carry `N orphaned`, `M new` and `map behind` badges (`KnowledgeRepoBadges`),
  only when non-zero / true. `renamed` is not badged: a re-attached context owes nothing.
- **The composer** shows `map behind the context map (<contextMapRevision> → <repoContextMapRevision>)`
  for a focused repo with `mapBehind`, with a **Compose map brief** action that records the
  existing brief dispatch at stage `map` (subscriptions are owed before verdicts). It is the same
  `composeBrief` call the conform brief uses; there is no new dispatch mode.

### What the sweep now reads from a registry map (`rkb-registry-map/1`, all additive)

Old maps parse unchanged; every new key has an "unknown" reading, never a fabricated one.

Per pair (`contexts[].subjects[]`), carried verbatim into `RepoConformance` and the matrix:

- `evaluatedRevision` (int) — the subject revision `/conform` judged at. Null for a verdict written
  before revisions existed. Rendered as `judged at r<n>` on the cell's context row.
- `revision` (int) — the subject's revision when the map was built. Null for an older builder.
- `arrived` (bool, default false) — the context was not in the previous map: a fresh subscription
  nobody has judged yet. Rendered as `new`.
- `source` (`match` | `retained` | `conform` | `renamed`, or null) — the builder's own word for how
  the pair got there. Stored, never interpreted.

Header (`stats`), carried onto `RepoConformanceMap` and the repo row:

- `orphanedVerdicts` — verdicts whose context left `context-map.json`. The map keeps their bodies
  under a top-level `orphans[]`; **ascent does not ingest the bodies** — repo-level counts are the
  design, and the bodies stay in the map where `/conform` can re-attach them.
- `arrivedContexts` — contexts absent from the previous map (every pair on them is `arrived`).
- `renamedContexts` — contexts the builder re-attached by path overlap (`source: "renamed"`).
- **Absent = an older builder, read as 0.** That is "0 orphans KNOWN", not "no orphans": a map
  that never counted cannot assert there are none. It is stored as 0 rather than null so readers do
  not carry a three-state read for a distinction the map itself cannot make.

Subject index (`knowledge/<domain>/index.json` → `subjects[<slug>]`), beside `digest`:

- `revision` (int) and `changedAt` (`YYYY-MM-DD`) — mirrored onto `OrgKnowledgeSubject` and shown
  on the subject as `r<revision> · <changedAt>`. `digest` is identity; `revision` is order — what
  lets a reader say "judged at r12, now r14" instead of merely "stale".

### The `mapBehind` rule

The sweep makes ONE additional GitHub read per swept repo that has a `context-map.json`: the file's
top-level `revision` (e.g. `"ecad2b58ad5f"`), stored as `repoContextMapRevision`. The map's own
`contextMapRevision` (the revision it was BUILT from) is stored beside it.

```
mapBehind = repoContextMapRevision !== null
         && contextMapRevision     !== null
         && repoContextMapRevision !== contextMapRevision
```

True means the context map moved after the registry map was built — subscriptions are owed, and a
`map` dispatch is the remedy. **Either side unknown → false.** A 404, a 403, a transport failure,
an oversized or torn body all read as `repoContextMapRevision: null`; an older map that carries no
`contextMapRevision` reads as null on the other side. A fetch failure is not evidence of drift, and
a sweep never fails because of this read — the worst it can cost is the drift signal for one repo.

The read is skipped (null, no request) when the root listing already said there is no
`context-map.json` — a repo at stage `populate` has nothing to be behind.

### What the matrix shows per cell

`KnowledgeCell.contextRows` — one row per subscribed context, worst state first then by name,
`contexts === contextRows.length` always. Each row: `name`, `group`, `state`, `stale` (this row's
OWN verdict predates the subject's digest — a cell can be current while one of its rows is stale),
`judgedRevision`, `arrived`. Absence cells have `contexts: 0` and `contextRows: []`.

### What a dispatch brief now says

- `conform`: a `## Subscribed contexts` section, one block per picked subject in the order picked,
  the subject line as `### <slug> — r<revision> · <changedAt>` when known, then
  `- <name> (<group>) — <state>[, stale][, judged at r<n>][, new]` in the fold's order. A subject
  with no rows is listed with `(no subscribed contexts in the map)`.
- `map`: a `## Context map` section with `Orphaned verdicts: n · arrived contexts: n · renamed
  contexts: n`, plus the two revisions when `mapBehind`.
- The dispatch route reads the same `getKnowledgeView` the tab renders and passes the picked
  subjects' rows and the repo's churn in (`briefInputsFromView`), so the brief and the composer
  agree by construction. A loader failure drops the two sections, never the dispatch.

## Stages, columns, and what can be picked

A swept repo stands at one of four stages (`repoStage`): `populate` (no `context-map.json`) → `map`
(no registry map) → `conform` (unjudged or stale pairs) → `current`. Matrix columns are the repos
**with a map**, most deviations first; the rest sit "off the loom" with their next act as the call to
action. Column headers carry the stage chip, the churn badges, and, in their title, the weakly-governed
contexts by name.

Pickable cells — `unknown`, `deviation`, `candidate`, or stale — thread into the composer for **one
repo at a time** (a brief is for one codebase). Picking in another column starts a new selection.

## Deep links and state

`?domain=<bundle>` and `?subject=<slug>` are tab-scoped (`TAB_SCOPED_PARAM_KEYS`), patched with
`router.replace` off the React-tracked search string. The composer's picks are not in the URL: a
half-composed brief is not a shareable state. The preview shell never writes the URL.

## The sweep and the calibration line

`SweepStrip` shows the last sweep's age — **"never run"** in the accent when nothing has been
swept, which every surface treats as "nothing is known", never as a clean fleet — its warnings,
whether the pair list was truncated, and the **Sweep fleet** button (admin). The sweep also chains
after every registry re-index and after a local dispatch; see the
[registry doc](../org-registry/README.md#the-sweep).

## Capabilities

`view.capabilities`: `canSweep` (the registry write gate), `canBrief` (admin), `canRunLocal`
(owner + `selfHosted()` + `autopilotEnabled()`). A control renders only when its flag is true. In its
place the composer names the state — `Briefs need the admin role.`, `Run here unavailable` — and the
three preconditions behind the local door are disclosed on a `WhyChip` rather than printed as
permanent chrome on every hosted deployment, where that door can never open.

## Empty and degraded states

| State | What renders |
| --- | --- |
| registry unmapped | the notice (plus, in development with `ASCENT_REGISTRY_PREVIEW=1`, the shaped-fleet preview) |
| last index failed | the error notice — no stale counts |
| no `knowledge/` lane | the empty notice |
| indexed, no subject rows for the bundle | a line saying the index pass predates the subject mirror — re-index |
| no repo mapped yet | the loom has chrome but no weft; the off-the-loom strip carries the next acts |

## Data

`OrgKnowledgeSubject` (with `digest`), `RepoConformanceMap` (one row per swept repo, `mapSha`
nullable, the foundation columns), `RepoConformance`, `RegistrySignal`, `RegistryDispatch` — see
[data-model.md](../data/data-model.md#org-knowledge--skills) and
[retention.md](../data/retention.md).

## Tests

| File | Pins |
| --- | --- |
| `KnowledgeLoom.dom.test.tsx` | the loom end to end; every legend row is the kit's swatch under the domain glyph; the subject provenance mark sits outside the row's button |
| `KnowledgeLoom.contexts.dom.test.tsx` | the context rows behind a folded cell; churn badges; the map-stage brief |
| `KnowledgeCoverage.dom.test.tsx` | a declared-but-unresolved bundle draws no numeral; the judged axis voids (never swept) and hatches (no map) |
| `KnowledgeSubjectImpact.dom.test.tsx` | one bar per mapped repo; **no number anywhere** when the impact is unmeasured |
| `knowledgeViz.test.ts` | `CELL_VIZ_STATE` is total over `KNOWLEDGE_CELL_STATES`; every `null`-not-zero path |

## Known gaps

- **Technique names are not mirrored.** The indexer stores each subject's technique COUNT and its
  flattened `use_when` triggers; the reader therefore lists triggers, not techniques. Subject is the
  finest grain the tab renders.
- **Signals are per contributor, not per repo.** The `signals/` lane cannot map to a cell; the reader
  shows a subject's consults / deviations and the matrix does not.
- **No scheduled sweep.** The sweep runs on the button, after a re-index, and after a local
  dispatch. A conform run done outside Ascent shows up only when one of those fires (follow-up idea
  `registry-sweep-cron`).
- **Under `sweep.truncated`** (the wire pair cap) a repo beyond the cap can read `current` early; the
  flag is the reader's warning.
