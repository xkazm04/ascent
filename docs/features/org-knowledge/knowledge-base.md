# Knowledge base — the registry's knowledge lane, and the fleet against it

**Status: CURRENT** (rebuilt 2026-09-05, spark `knowledge-base-rebuild`; the Loom direction won the
prototype round over Atlas and Board).

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
| `KnowledgeComposer.tsx` | the dispatch composer + the hand-off ledger |
| `KnowledgeSubjectDetail.tsx` | the subject reader (a `Modal`); footer deep-links to the UI surfaces showcase when `isSurfaceShowcased(slug)` |
| `KnowledgeShared.tsx` | `CellButton`, `StateLegend`, `StageChip`, `Spectrum`, `SweepStrip`, `DomainPicker` |
| `knowledgeModel.ts` / `knowledgeVocabulary.ts` | pure derivations; labels, glyphs and tones for the eleven states and four stages |
| `useKnowledgeSelection.ts` | domain / focused subject / picked cells; URL sync |
| `useKnowledgeActions.ts` | the one client call path for sweep, compose-brief, run-local |
| `KnowledgePreviewShell.tsx` | dev-only shaped-fleet preview (`registryPreviewEnabled()`, unmapped only, actions inert) |
| `src/lib/org/knowledge-shape.ts` | the client-safe wire contract (`KnowledgeView`, `KnowledgeCell`, `RegistryDispatchRow`, …) |
| `src/lib/org/knowledge-view.ts` (+ `knowledge-fleet.ts`) | the server loader; the dense subject × repo fold |
| `src/lib/org/knowledge-view.fixture.ts` | the shaped fixture — the real software-engineering taxonomy (52 of 214 subjects) over an eight-repo fleet reaching every state and stage |
| `src/lib/registry/absence.ts` | `classifyAbsence` (a verbatim port of the registry's `build-fleet-map.mjs` rule) and `repoStage` |
| `src/lib/registry/conformance-fold.ts` | worst-wins fold of a subject's judged pairs; `stale` |
| `src/lib/registry/taxonomy.ts`, `conformance-foundation.ts` | the indexer's taxonomy mirror; the sweep's manifest / directions / context-map readers |

The Registry tab keeps onboarding, sync and index health and points here (`RegistryKnowledgePointer`);
it renders no subject-level panel of its own.

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

## Stages, columns, and what can be picked

A swept repo stands at one of four stages (`repoStage`): `populate` (no `context-map.json`) → `map`
(no registry map) → `conform` (unjudged or stale pairs) → `current`. Matrix columns are the repos
**with a map**, most deviations first; the rest sit "off the loom" with their next act as the call to
action. Column headers carry the stage chip and, in their title, the weakly-governed contexts by name.

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
(owner + `selfHosted()` + `autopilotEnabled()`). A control renders only when its flag is true; the
composer says which role or flag is missing otherwise.

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
