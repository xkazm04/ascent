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
| `?tab=surfaces` | the gallery: every subject as a card, grouped by subcategory in the taxonomy's order — showcased cards link into their scene; absence cards say `Not yet showcased — run /surface <slug>`; input-and-editing cards say they are out of this repo's scope (`.ai/manifest.yaml`) |
| `&subject=<slug>` | the scene: toolbar (path kicker, freshness badge, fixture-volume chips, "simulate reduced motion", back to gallery) · rail · canvas · drawer. A slug with no showcase lands on the gallery with that subject's absence card ringed |
| `&technique=<slug>` | the drawer open on that technique; its region is ringed and the rest of the scene dimmed |

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
| `SurfacesGallery.tsx` / `SurfaceCard.tsx` | the grouped gallery; showcased, absence and out-of-scope cards |
| `SurfaceScene.tsx` | client orchestrator: selection, body + scope chunk load, quiet gap, inline error card with retry |
| `SurfaceFrame.tsx` | toolbar · rail · canvas · drawer; owns the spotlight effect |
| `SurfaceRail.tsx` / `SurfaceDrawer.tsx` / `SurfaceControls.tsx` | the technique list (`aria-current`, arrow keys), the mechanism reader, the knobs |
| `SurfaceFreshnessBadge.tsx` | `freshnessOf()` + the badge |
| `useSurfaceSelection.ts` | technique (URL) + simulate-reduced + volume (local) |
| `surfaceSpotlight.ts` | `applySpotlight(root, selected)` / `regionSlugs(root)` |
| `<slug>/{index.ts, Scene.tsx, techniques.ts, fixtures.ts, brief.md, Scene.dom.test.tsx, …}` | one folder per showcased subject |

## Showcased subjects

| Subject | Subcategory | Techniques | Authored against | Scene |
| --- | --- | --- | --- | --- |
| `motion` | feedback-and-style | 10 | `sha256:89022fde06571042` (2026-09-06) | an instrument panel: preset vocabulary, budgets meter, three engines, ref-driven frames, one-shot guard, reduced/degradation, ambient loop with merged pause |

## Known gaps

- Only `motion` is showcased; the other 32 subjects render absence cards until their `/surface` run
  lands (input-and-editing's eight are out of scope by manifest and will stay absence cards).
- The freshness badge depends on the org having indexed the registry with the digest mirror; older
  index passes carry `digest: null` and show no badge.
- The rail is a local list, not `SectionRailNav`; if a second flat, state-driven rail appears, extract
  a shared primitive.
