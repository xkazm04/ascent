# UI surfaces — the registry's ui-surfaces subjects as live scenes

**Status: CURRENT** (WP1 of spark `ui-surfaces-showcase`, 2026-09-06; one reference scene shipped,
the remaining showcases land through `/surface <slug>` runs).

Org dashboard tab `?tab=surfaces`, last in the **Shared** group. It shows the registry's
`ui-surfaces` subjects (the software-engineering bundle, 33 subjects in five subcategories) as
**composed, interactive React/Tailwind/Motion scenes**: a technique rail on the left, the live scene
in the middle, and a mechanism drawer for the selected technique — prose, the source excerpt, where
Ascent already realizes it, and where Ascent falls short.

A showcase is a **repo-shipped artifact**, not org data: a typed catalog record keyed by subject slug
plus a scene body loaded on demand. At render the catalog is joined to the org's registry index
mirror (`OrgKnowledgeSubject`) for a **digest-freshness badge**, and the Knowledge base's subject
reader deep-links into the scene. Nothing here judges the fleet; it is reference about reference.

## What the tab is

| URL | View |
| --- | --- |
| `?tab=surfaces` | the gallery: one column per subcategory in the taxonomy's order, every subject a single line sorted by name — showcased lines link into their scene and carry a technique count; unshowcased ones are muted; a whole out-of-scope category says so once under its header (`.ai/manifest.yaml`). Category and name are the metadata here; a subject's summary lives in its scene |
| `&subject=<slug>` | the scene, in three rows: masthead + numbered technique index · the canvas showing ONE region · the reader (Mechanism / Source / In Ascent / Deviation, one page at a time). With no `technique` the first one is live; "show the whole scene" restores every region. A slug with no showcase lands on the gallery with that subject's line ringed |
| `&technique=<slug>` | that technique is the live one: its region is the only one in layout (the scene stays mounted, so a running instrument keeps its state) and the reader below is on it |

`subject` and `technique` are both in `TAB_SCOPED_PARAM_KEYS`, so a tab switch clears them. The
technique is written with `router.replace` off the React-tracked search string; the simulate toggle
and the volume are local state (a simulated preference is not a shareable URL).

## The catalog / body contract

- `src/lib/org/surface-catalog.ts` (client-safe, no React) — `SURFACE_SUBJECTS` (the static mirror of
  the ui-surfaces branch, 33 entries, taxonomy order), `SURFACE_CATALOG` (one `SurfaceRecord` per
  authored scene: slug, subcategory, title, summary, `authoredAgainst: { digest, verifiedOn }`,
  `techniqueSlugs`), `isSurfaceShowcased`, `surfaceRecord`, `isSurfaceOutOfScope`,
  `SURFACE_VOLUMES = [50, 5000, 50000]`.
- `src/features/shared/surfaces/surfaceBody.ts` — `SurfaceBody = { Scene, techniques }`;
  `SurfaceSceneProps = { technique, reduced, volume }`; `SurfaceTechnique = { slug, title, mechanism,
  source, inAscent, deviation }`.
- `src/features/shared/surfaces/surfaceBodies.ts` — `SURFACE_BODIES`: one dynamic `import()` per
  showcased slug. **This is the only door framer-motion enters the tab through**; the frame, gallery,
  rail and drawer import none of it. The MotionConfig scope (`surfaceMotionScope.tsx`) is loaded the
  same way, alongside the body.
- `surfaceCatalog.test.ts` pins the bijection: every record ⇄ body, unique slugs, every record slug ∈
  `SURFACE_SUBJECTS`, every `techniqueSlugs` entry ⇄ a body `techniques` entry.
- Scene contract: every region that embodies a technique carries `data-technique="<slug>"`
  (`surfaceSpotlight.ts` rings the selected one and dims the rest); scenes use `@/components/ui`
  primitives and `type-*` classes only; non-transform decisions read `reduced` from props, never their
  own media query.
- Freshness: `src/lib/org/surface-freshness.ts` (server) reads `listOrgKnowledgeSubjects(orgId,
  "software-engineering")` and degrades to `{}`; `authoredAgainst.digest === mirror.digest` →
  "current", differ → "authored against an older subject", no mirror or null digest → no badge.

## The skill

`/surface <subject-slug> [--refresh] [--force]` (`.claude/skills/surface/`, project-owned) is the
procedure that turns a subject's golden path + techniques + applications into a scene, gates it, registers
it, and logs the consult + application leads. It refuses input-and-editing subjects without `--force`.

## Surfaces

| Path | Role |
| --- | --- |
| `src/features/shared/surfaces/SurfacesTab.tsx` | server tab; reads `sp.subject` / `sp.technique`; gallery or scene |
| `SurfacesGallery.tsx` | the gallery: five subcategory columns, subjects by name, `sceneHref()` |
| `SurfaceScene.tsx` | client orchestrator: selection, body + scope chunk load, quiet gap, inline error card with retry |
| `SurfaceFrame.tsx` | the three rows: index · canvas · reader; owns the solo-region effect |
| `SurfaceHeader.tsx` | the masthead: taxonomy path, title, freshness badge, authored-against line |
| `SurfaceMechanismParts.tsx` | the four readings a technique has to give, as placeable blocks |
| `SurfaceControls.tsx` | the knobs: fixture volume, simulate reduced motion, back to the gallery |
| `SurfaceFreshnessBadge.tsx` | `freshnessOf()` + the badge |
| `useSurfaceSelection.ts` | technique (URL) + simulate-reduced + volume (local) |
| `surfaceSpotlight.ts` | `applySoloRegion(root, selected)` (the frame's layout mode) · `applySpotlight` / `regionSlugs` (the region contract each scene's test asserts) |
| `<slug>/{index.ts, Scene.tsx, techniques.ts, fixtures.ts, brief.md, Scene.dom.test.tsx, …}` | one folder per showcased subject |

## Showcased subjects

| Subject | Subcategory | Techniques | Authored against | Scene |
| --- | --- | --- | --- | --- |
| `motion` | feedback-and-style | 10 | `sha256:89022fde06571042` (2026-09-06) | an instrument panel: preset vocabulary, budgets meter, three engines, ref-driven frames, one-shot guard, reduced/degradation, ambient loop with merged pause |
| `accessibility` | feedback-and-style | 8 | `sha256:e7079c6845ba0270` (2026-09-06) | a follow-ups desk: roving segment strip, native-first worklist, drawer closing both hiding channels, one announcer with a drain queue, wired name chain, one preference signal, gates over its own DOM, dated pairing matrix |
| `adaptive-fidelity-tiers` | feedback-and-style | 6 | `sha256:b28d9f28795d6750` (2026-09-06) | an ambient strata header with its fidelity instrument: a p90-window probe publishing a tier that falls on one bad window, climbs on a run, holds in the dead band, settles on a deadline, defers to idle, reads per-effect budgets, and is never created under a preference |
| `async-ui-states` | feedback-and-style | 7 | `sha256:4d89ccb3b7b69ed0` (2026-09-06) | a fictional org page of independent async regions at a latency dial: repository search with its state ledger, key classification and arrival instruments, a review queue with busy buttons, cause-typed empties, a failable alerts feed |
| `design-tokens` | feedback-and-style | 6 | `sha256:285d0bf6dac74e64` (2026-09-06) | an appearance panel: one scope root generated from one token authority, a preview card that names roles and never a theme, regions that rebind it (theme, density, text scale) or gate it (admission, parity, enforcement) |
| `status-vocabulary` | feedback-and-style | 6 | `sha256:0bdc30b0870393c6` (2026-09-06) | a fleet scan ledger: token-keyed pills with a decided unknown direction, a locale-bound number renderer, one shared elapsed-time ticker with the future clamped, text-only labels, the add-a-member checklist |
| `data-viz` | data-display | 6 | `sha256:b6657691892c6b9b` (2026-09-06) | a fleet instrument board: headline tile with its daily strip, small multiples, a sparkline column, a multi-series chart with a stable identity palette, a lazily-engined dashboard row, one slot walking every empty and degraded state |
| `feed` | data-display | 5 | `sha256:23236fee1ffbf827` (2026-09-06) | a fleet-activity feed over one store: one (ts, seq) comparator with a swap-counting refetch, a viewport that holds arrivals behind a "N new" pill and walks a cursor on reconnect, sync bursts folded into cluster rows at render, an anchor-derived unseen badge with a frozen entry snapshot, a declared retention whose horizon renders as an edge |
| `canvas-graph` | data-display | 6 | `sha256:9eedbc25626767bc` (2026-09-06) | a dependency atlas of a fictional org: pan/zoom node surface with one camera authority, a culled and waved render list sized by the volume knob, threshold-decided drags, provenance-aware layout, an edge economy, a roving keyboard cursor |
| `toasts-notifications` | feedback-and-style | 6 | `sha256:4c6dc8858a53f603` (2026-09-06) | a fleet desk whose out-of-band news flows through one store: a severity table every channel derives from, a transient stack with queue policy, toasts that are doors (undo window, verified retry), a durable center sharing the same identities, a simulated OS tier with a consent matrix, one serial announcer |
| `file-browsing` | data-display | 6 | `sha256:ae56dce70c40004c` (2026-09-06) | a vault browser over a fictional knowledge registry a sync agent keeps writing to: tree and trail off one location, a windowed directory read that admits its staleness, identity selection with a predicate select-all, rename/move/trash through one guard door with per-item reports, previews cached on id@version |
| `search` | data-display | 7 | `sha256:54682051824eb2b3` (2026-09-06) | a fleet search over a fictional corpus: a query door that reflects its parse as chips and labels the ladder rung, an inverted index kept honest against its source, total-order ranking with engine-derived excerpt marks, facets whose counts carry their predicate, saved views validated against the live schema, a command palette on one registry, a rule box that types a predicate before it runs |
| `diff-comparison` | data-display | 7 | `sha256:0df03bbd2dcbaf5d` (2026-09-06) | a scan comparison desk: baseline species chosen by question, three levels with a phantom-edit count and keyed alignment, an offload hook with request identity / budget ladder / kill switch, three presentation modes from one result, a cut marker that only counts what was counted, whitespace and homoglyph marks with a counted suppression, a passport drift ledger with identity across re-runs |
| `table` | data-display | 5 | `sha256:6a77e71f01e80b19` (2026-09-06) | a fleet ledger you can use for a minute: a toolbar that owns the client/server split with a written-down all-client bound, a body running the five-state machine under always-present chrome, a footer paging by offset or keyset with a count that carries its predicate, two instruments reading the order contract and the performance ladder off the same live state |

## Known gaps

- 14 of 33 subjects are showcased (all of feedback-and-style and data-display). The 11
  published-surfaces and shell-and-navigation subjects render absence cards until their `/surface`
  run lands; input-and-editing's eight are out of scope by manifest and stay absence cards.
- The freshness badge depends on the org having indexed the registry with the digest mirror; older
  index passes carry `digest: null` and show no badge.
- The gallery and the frame were redesigned on 2026-09-06 (prototype round: Columns beat a ledger and
  the original cards; Dossier beat a console and the original three columns). Measured full-page
  height on a 1440x900 viewport: gallery 3981px → 900px, the ten-region motion scene 3076px → 1065px.
- Solo mode takes the unselected regions out of LAYOUT (`display:none`); it does not unmount them, so
  the scene keeps its state while you switch. True per-region mounting would need every scene to
  expose its regions individually — a contract change across all 14.
- The brand treatment of the tab's own chrome (index cells, reader chips, canvas) is unresolved and
  scheduled for its own round.
- Scenes were observed in headless Chromium (zero page errors, every declared region present); no
  axe pass runs yet, so the accessibility scene's claims are verified by its own jsdom gates only.
