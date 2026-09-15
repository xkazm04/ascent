// The drawer entries for the canvas-graph scene: one per technique of the registry's `canvas-graph`
// subject (authored against sha256:9eedbc25626767bc, 2026-09-06), in the golden path's order.
// `mechanism` is the React/SVG mechanism the region demonstrates; `source` is the scene's own code;
// `inAscent` cites the real Ascent file read for it (see brief.md for the grep); `deviation` names
// where Ascent — or this scene — falls short of the technique.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "viewport-transform",
    title: "Viewport transform",
    mechanism:
      "camera.ts is the only module that knows `screen = world × z + pan`: `toWorld`, `toScreen`, `worldDelta`, `zoomAt`, the visible rectangle and the fit transform all live there, and `zoomAt` clamps the scale so no entry point can zoom past the range. " +
      "The wheel (native, non-passive, on the svg itself), the keys and the buttons all route through `zoomAt` and differ only in the pivot — cursor or viewport centre — so content never rockets toward a corner. " +
      "During a pan the world `<g>` is driven imperatively from a live copy and the state commits on release, plus an interim commit every half cull-margin of travel so culling follows a long pan; wheel notches coalesce to one commit per frame. " +
      "A layout effect re-asserts the live transform after any render that lands mid-gesture — the one-line guard against reconciliation snapping the view back. " +
      "Fit and fly are cancellable tweens (a cancelled one still commits where it stopped); under `reduced` they are cuts.",
    source: S.SRC_VIEWPORT,
    inAscent: {
      file: "src/features/inflight/live/observatory/ObservatoryLasso.tsx",
      note: "`toData()` is the one screen→data conversion for the observatory field — every pointer reading passes through it — though the field is fit to its container, so there is no zoom or pan to convert.",
    },
    deviation: "Ascent has no pan/zoom surface: the launch star-map and the observatory are fit-to-container renderers (the technique's retired stage), so no transform authority, no zoom-to-point and no wheel policy exist anywhere in the repo.",
  },
  {
    slug: "render-budget",
    title: "Render budget",
    mechanism:
      "Nodes position themselves in world units and never receive the camera; the world `<g>` carries the transform, so a pan re-renders zero nodes — the node-render counter in the panel holds still while you drag the sea. " +
      "renderList.ts is a `useMemo` over named inputs (graph, positions, committed camera, viewport, edge settings, focus): it culls against the overscanned visible rectangle before formatting anything, returns an empty set until the viewport is measured, and culls edges by their own bounding box rather than by endpoint visibility. " +
      "The visible set mounts in waves — a slice per animation frame, nearest-to-centre first, the next slice halved when the previous one overran 8ms — and the budget only grows. " +
      "`NodeView` is `memo`'d on its own record and booleans; the gesture handlers are one stable bundle that reads `data-node-id`, so no node ever sees a fresh closure. " +
      "Detail is a function of zoom in three tiers (bundle < 0.18, rect < 0.45, full), with the label counter-scaled (z^-0.62) and faded in on a ramp through custom properties on the `<g>` that nodes inherit without rendering.",
    source: S.SRC_BUDGET,
    inAscent: {
      file: "src/components/launch/fleetMapStars.ts",
      note: "`starPosition` memoizes every placed position by its only inputs (index, total, seed) in `positionCache`, so a score-only frame recomputes zero geometry; `ConstellationField` turns the twinkle off past `DENSE_FLEET_STARS`.",
    },
    deviation: "The star-map slices to `MAX_STARS` rather than culling to a viewport, no star is `React.memo`'d (0 hits for `memo(` outside this scene), and nothing in Ascent draws detail as a function of zoom — there is no zoom.",
  },
  {
    slug: "direct-manipulation",
    title: "Direct manipulation",
    mechanism:
      "A node captures the pointer at press because the node is the whole gesture target; the sea captures only when a 3px screen-space threshold turns the press into a pan, so child clicks keep firing, and it eats the trailing click the platform synthesizes after a pan. " +
      "Click versus drag is decided by movement, never by a timer: nothing is written to the model before the threshold, and release below it is a click that selects (shift toggles). " +
      "The drag is origin plus the converted delta — through `worldDelta` in the authority — written imperatively to the dragged `<g>`s and re-asserted after any render, then committed as exactly one `move` transaction on release; the ledger shows one entry per gesture. " +
      "Connecting drags a provisional edge from a port whose hit circle exceeds its dot; with the pointer captured, the target is found by hit-testing under the cursor and its validity (self, duplicate, cycle, lib→app) is shown on the node during the hover, never as a rejection after release. " +
      "Escape returns the nodes and discards the provisional edge with the model untouched — provisional-until-commit is what makes cancel clean.",
    source: S.SRC_MANIPULATION,
    inAscent: {
      file: "src/features/inflight/live/observatory/ObservatoryLasso.tsx",
      note: "`useLasso` captures the pointer at press, keeps the rubber band as gesture state that never touches the model, and decides click vs drag by a movement threshold on release (`dragged`), releasing capture on every exit path.",
    },
    deviation: "The lasso's threshold is 1.5 data units, not screen pixels, and no Ascent surface drags a node, connects two, or shows live validity — `ColumnResizer` is the only other capture-based drag and it resizes rather than moves.",
  },
  {
    slug: "graph-layout",
    title: "Graph layout",
    mechanism:
      "Positions are user data: the store keeps a `placed` map with a provenance bit, and `positionOf` is the one door — a stored placement wins, otherwise the layered derivation for the current run. " +
      "The generated layout is layered and deterministic (same graph in, same layout out); re-layout bumps the run and re-flows generated positions only, while user-authored ones are anchors it may not move; the moment a drag or a nudge lands, that node's position is user-authored for good. " +
      "Reset is the deliberate, confirmed doorway back to all-generated, and it is one transaction because it destroys spatial memory. " +
      "A node added from the panel lands beside the focused node through the placement policy — probing outward ring by ring until the slot is clear — never at the origin under everything else. " +
      "The layout document is versioned and keyed by node identity; the panel previews it, and the notes say what happens on a version mismatch: a visible re-layout, never a silent mis-scale.",
    source: S.SRC_LAYOUT,
    inAscent: {
      file: "src/components/launch/fleetMapStars.ts",
      note: "`starPosition` is a deterministic layout keyed by the repo's own identity (`fullName` seeds the jitter), and `appendedStarPosition` is a placement policy for a node that arrives mid-session: an outer ring that never shifts an existing star.",
    },
    deviation: "Nothing in Ascent stores a user-authored position: the star-map is generated-only with no provenance, no persistence and no re-layout command, which is legitimate for a renderer but leaves the layout-as-document half of the technique unrealized.",
  },
  {
    slug: "edge-management",
    title: "Edge management",
    mechanism:
      "geometry.ts owns one `nodeBounds` and one `anchorToward`; node rendering, edge rendering, the fat hit stroke, culling and the placement policy all read them, so an edge cannot float off its node — the anchor is the boundary point facing the other endpoint, recomputed as nodes move. " +
      "Edges have their own minted ids (`e-<n>`), never the pair; a connect gesture mints a new one. " +
      "The economy is editorial: kinds are drawn one dimension at a time by default (the union is an explicit mode), focus-context keeps the hovered, focused or selected node's edges at full ink and recedes the rest, the rect tier drops low-weight edges, and the far tier collapses everything into one weighted bundle per adjacent layer pair. " +
      "A one-pixel path is pressed through a transparent stroke of `hitWidth` screen pixels laid over the same geometry; the selected edge thickens and lifts, and arrowheads sit at the anchor, oriented by the marker along the final segment. " +
      "The panel answers the economy's test for the focused node: what does this connect to, in any view.",
    source: S.SRC_EDGES,
    inAscent: {
      file: "src/components/launch/ConstellationField.tsx",
      note: "The constellation lines and the stars read one shared `starData` derivation (position, look, dim) so a line cannot point at where a star used to be; a filtered-out star's line recedes to 0.03 opacity — focus-context by dimming.",
    },
    deviation: "Star-map lines are keyed by endpoint (`l-${fullName}`) rather than a minted edge identity, they are `pointer-events`-less with no hit stroke, and every line is always drawn — there is no kind, weight or zoom economy.",
  },
  {
    slug: "canvas-accessibility",
    title: "Canvas accessibility",
    mechanism:
      "The svg is one focusable region (`tabIndex=0`, `role=\"application\"`) whose accessible name counts the graph; Tab reaches it once, never once per node, and `aria-activedescendant` names the roving cursor's node. " +
      "Arrow keys move the cursor spatially (nearest node inside a 90° cone that way) or topologically (outgoing target, incoming source, siblings) — the panel's switch — and every landing is announced in graph terms (name, kind, inputs, outputs, selected) and panned into view, because focus the user cannot see is focus lost. " +
      "Focus is not selection: Enter selects, Shift+Enter toggles, Shift+arrows nudge as one `move` transaction per key, `c` enters a connect pick that travels eligible targets only, and +/−/0 are the zoom and fit keys beside the real buttons. " +
      "The jump palette lands on a node by name with the camera framed; the outline lists the cursor node's connections as text — the same model, document-shaped. " +
      "Under `reduced`, every camera flight is a cut.",
    source: S.SRC_A11Y,
    inAscent: {
      file: "src/components/launch/ConstellationField.tsx",
      note: "The map svg is `role=\"group\"` with a name that states the real repository total and how many are drawn, and each star is an `<a>` with a full `aria-label` — the graph announced as itself, not as shapes.",
    },
    deviation: "Every star is its own tab stop — up to 80 per org, the exact 'tab order fills with one stop per node' failure — with no roving cursor, no topological travel and no outline; `IdentityMenu` has the roving pattern, but no canvas uses it.",
  },
];
