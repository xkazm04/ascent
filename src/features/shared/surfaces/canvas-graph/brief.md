# Canvas graph - showcase brief

subject: canvas-graph
subcategory: data-display
digest: sha256:9eedbc25626767bc
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/data-display/canvas-graph/canvas-graph.md

Read: the golden path, all six techniques (`viewport-transform`, `render-budget`,
`direct-manipulation`, `graph-layout`, `edge-management`, `canvas-accessibility`), both
applications (`react--render-budget.md`, `react--viewport-transform.md`), and the three laws the
techniques cite (`one-authority-per-vocabulary`, `derivation-names-recomputation`,
`identity-survives-reuse`). The reference scene `motion/` and `BRAND.md`.

## Scene concept

A **dependency atlas** of a fictional org's repositories: a pan/zoom node surface where nodes are
repos (app / service / lib, with a maturity score), edges are import / deploy / reference
relationships, and the viewer can pan, zoom, drag, connect, re-layout and walk the graph by keyboard
for a minute without knowing it is a showcase. It is the right host because every technique of the
subject is a natural part of one canvas: the camera IS the viewport-transform region, and the five
instruments around it (budget, gesture ledger, layout provenance, edge economy, the graph as text)
read from and write to that same canvas rather than staging a separate demo each. The volume knob
sizes the world (50 / 5,000 / 50,000 nodes, ~1.4 edges per node); culling, tiers and waved mounting
are what let the 50,000-node world render a window instead of 50,000 SVG groups.

Files: `camera.ts` (the authority), `geometry.ts` (shared node/edge geometry, layered layout,
placement policy, zoom tiers), `fixtures.ts` (seeded graph), `graphStore.ts` (reducer: provenance,
transactions, validity), `renderList.ts` (the named derivation), `useCamera.ts`, `useNodeGestures.ts`,
`useKeyboardNav.ts`, `useWavedMount.ts`, `CanvasRegion.tsx`, `NodeView.tsx`, `EdgeLayer.tsx`, five
panels, `sceneParts.tsx`, `sources.ts`, `techniques.ts`, `Scene.tsx`, `Scene.dom.test.tsx`.
No framer-motion: the only motion is the camera, and the camera is the subject.

## Techniques

### viewport-transform
- use_when matched: "deciding where screen-world conversion lives"
- mechanism to show: `camera.ts` owns `toWorld` / `toScreen` / `worldDelta` / `zoomAt` (clamped) /
  `visibleRect` / `fitTo`; wheel (native, `{ passive: false }`, on the svg), keys and buttons all
  route through `zoomAt` with different pivots; pan is imperative on the world `<g>` with commit on
  release plus an interim commit per half cull-margin; wheel coalesces to one commit per rAF; a
  `useLayoutEffect` re-asserts the live transform mid-gesture; fly is a cancellable tween that still
  commits on cancel, and a cut under `reduced`.
- region: `CanvasRegion.tsx` (the canvas itself)
- Ascent evidence: `src/features/inflight/live/observatory/ObservatoryLasso.tsx` `toData()` — one
  screen→data conversion for the observatory svg (grep: `rg "toData|setPointerCapture" src`).
  `rg "toWorld|toScreen|zoomAt|onWheel|passive: false" src` → 0 hits outside this scene.
- deviation: Ascent has no pan/zoom surface; the star-map and observatory are fit-to-container
  renderers (the golden path's retired stage), so no authority, zoom-to-point or wheel policy exists.
- applications read: `react--viewport-transform.md` — mechanisms taken: `camTransform` as the one
  serialisation, `zoomAt` clamp with exported bounds, wheel accumulate + flush per rAF, the
  `useLayoutEffect` reconciliation guard, interim commits at ~half the cull margin
  (`PAN_COMMIT_WORLD = 350` ≈ `CULL_MARGIN / 2` → here `CULL_MARGIN 200` / 2), native non-passive
  wheel on the svg not the container, capture-at-threshold + trailing-click suppression for the
  surface vs capture-at-press + `stopPropagation` for nodes, cancelled tween still resolves.
  Nothing cited as Ascent's.

### render-budget
- use_when matched: "deciding whether nodes may see the transform"
- mechanism to show: nodes take world `x, y` and never the camera; the world `<g>` carries the
  transform and two custom properties (`--label-scale = z^-0.62`, `--label-opacity` ramp) that
  labels inherit without a render; `renderList.ts` is a `useMemo` over named inputs, empty before
  the viewport is measured, culling before formatting, edges culled by their own bounding box;
  `useWavedMount` mounts the ranked visible set in adaptive slices (8ms budget, only grows);
  `NodeView` is `memo`'d with one stable handler bundle reading `data-node-id`; three zoom tiers.
- region: `BudgetPanel.tsx` (the instrument; the counters read the canvas)
- Ascent evidence: `src/components/launch/fleetMapStars.ts` `positionCache` memo keyed by
  (index, total, seed) and `DENSE_FLEET_STARS`; `src/components/launch/ConstellationField.tsx`
  `animateStars` off for large fleets (grep: `rg "positionCache|DENSE_FLEET_STARS" src`).
  `rg "React\.memo|= memo\(" src` → 0 hits.
- deviation: `MAX_STARS` slice, not viewport culling; no memoized node component; no detail-by-zoom
  because there is no zoom.
- applications read: `react--render-budget.md` — mechanisms/numbers taken: empty-before-measured,
  waved mounting under a frame budget with halving/doubling, nearest-to-centre fill order with stable
  child order, `labelScale(k) = k^-0.62`, `lod(k, from, to)` opacity ramps, edges culled by geometry
  (the application's own stated shortfall). Nothing cited as Ascent's.

### direct-manipulation
- use_when matched: "deciding whether a press is a click or a drag"
- mechanism to show: node captures at press, sea captures at the 3px threshold and suppresses the
  trailing click; movement threshold in screen space, no model write before it; drag = origin +
  `worldDelta`, imperative on the dragged `<g>`s, re-asserted after renders, one `move` transaction
  on release (history ledger); connect from a port with a fat hit circle, provisional edge drawn
  imperatively, target by `elementFromPoint`, validity live on the node (`connectValidity`:
  self / duplicate / cycle / lib→app), release elsewhere cancels; Escape restores.
- region: `ManipulationPanel.tsx` (state + ledger; the gesture lives on the canvas)
- Ascent evidence: `src/features/inflight/live/observatory/ObservatoryLasso.tsx` `useLasso`
  (capture at press, gesture state never in the model, click-vs-drag by movement on release,
  capture released on every path); `src/features/inflight/live/outcome/ColumnResizer.tsx`
  (grep: `rg "setPointerCapture" src` → 2 files).
- deviation: lasso threshold is 1.5 data units not screen px; no node drag, connect or live
  validity exists in Ascent.
- applications read: `react--viewport-transform.md` (capture timing and the trailing click).

### graph-layout
- use_when matched: "deciding whether auto-layout may move a node"
- mechanism to show: `placed: Map<id, {x, y, provenance}>`; `positionOf` is the one door;
  `generatedPosition` is layered and deterministic; `relayout` bumps the run (generated re-flow,
  user anchors held); a drag or nudge flips provenance to user; `reset` is confirmed (two-step
  button) and one transaction; `add node` lands beside the focused node via `placeNear` (ring
  probe); the panel previews the versioned layout document keyed by node id.
- region: `LayoutPanel.tsx`
- Ascent evidence: `src/components/launch/fleetMapStars.ts` `starPosition` (deterministic,
  identity-seeded) and `appendedStarPosition` (a placement policy that never shifts existing stars)
  (grep: `rg "appendedStarPosition|starPosition" src`).
- deviation: no user-authored positions, provenance, persistence or re-layout anywhere in Ascent
  (renderer stage).
- applications read: none for this technique; the golden path's persistence section informed the
  document preview. Migration itself is out of the read (see below).

### edge-management
- use_when matched: "deciding which edges deserve ink in the current view"
- mechanism to show: `nodeBounds` / `anchorToward` in `geometry.ts` read by nodes, edges, hit
  strokes, culling and placement; minted edge ids; kinds drawn one at a time by default with the
  union explicit; focus-context on hover/cursor/selection; rect tier drops weight < 3; bundle tier
  aggregates adjacent-layer edges into weighted bundles; a transparent `hitWidth / z` stroke over the
  same path for clicks; arrow marker at the anchor; "what does X connect to" answered in the panel.
- region: `EdgePanel.tsx`
- Ascent evidence: `src/components/launch/ConstellationField.tsx` — lines and stars read one
  `starData` derivation; filtered stars' lines recede to 0.03 (grep: `rg "starData" src`).
- deviation: lines keyed by endpoint pair, no hit stroke, every line always drawn.
- applications read: `react--render-budget.md` (edges keyed by pair named as a shortfall).

### canvas-accessibility
- use_when matched: "tab order fills with one stop per node"
- mechanism to show: one focusable svg (`role="application"`, counted name,
  `aria-activedescendant`); roving cursor with spatial / topological travel; `describe()` announced
  through one polite live region; cursor panned into view; Enter selects (focus ≠ selection);
  Shift+arrows nudge; `c` connect pick over eligible targets; +/−/0 keys and real buttons; jump
  palette; the cursor node's connections as an outline; reduced → cuts.
- region: `A11yPanel.tsx`
- Ascent evidence: `src/components/launch/ConstellationField.tsx` (`role="group"` with a counted
  name; per-star `<a aria-label>`); `src/components/header/IdentityMenu.tsx` (roving focus with
  `tabIndex={-1}`) (grep: `rg "roving|aria-activedescendant" src`).
- deviation: every star is a tab stop (up to 80 per org); no roving cursor, topological travel or
  outline on a canvas.
- applications read: none for this technique.

## Out of the read

- Layout **migration** across document versions (the persistence half of graph-layout) is described in
  the panel copy but not simulated: there is no stored document to migrate in a fixture scene.
- Marquee selection and snapping/alignment guides (direct-manipulation) are not built; the scene shows
  click / shift-click / drag / connect and a per-gesture ledger. Undo itself belongs to undo-history.
- Orthogonal / obstacle-avoiding routing is not attempted; curves are the pipeline convention.
- Screen-reader announcements are a visible polite live region; no assistive-technology pairing was
  run (that is the accessibility subject's verification technique).
- Observation (headless-Chromium screenshot) is the Director's step in builder mode.
