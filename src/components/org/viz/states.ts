// The epistemic state vocabulary for the /org dashboard — ONE definition, imported everywhere.
//
// The /org redesign's diagnosis (docs/ORG-UX-REDESIGN.md §1, anti-pattern A2) is that the most
// valuable sentences on the dashboard are epistemic qualifiers delivered as prose:
//   "A dash under State means the control was not readable — missing evidence, not a finding."
//   "An em dash is a missing measurement, not a zero."
//   "declared, not enforced."
//   "The tier a scan DERIVES is a measurement. Admission is the decision."
// Prose cannot enforce any of that: nothing stops a reader from reading a dash as a zero. A visual
// system can — filled vs outlined vs hatched vs absent — and that is what this module encodes.
//
// Every later wave imports this file. No wave re-defines a hatch, a dash pattern or a state label:
// an agent that hand-rolls a 45° pattern has failed the wave (§3). Colour comes from LEVEL_HEX /
// scoreHex (@/lib/ui) or a CSS token — never a hand-picked hex (BRAND.md).
//
// Server-safe: no hooks, no client boundary. `VizDefs` is built with `createElement` rather than JSX
// so the whole vocabulary — labels, hints, paints AND the shared <defs> — stays in this one `.ts`
// module with no import cycle back into it.

import { createElement, type ReactElement } from "react";

/**
 * The six states any mark on the org dashboard can be in. Ordered from "we saw it" to "we no longer
 * count it"; `VIZ_STATES` preserves that order for legends and tests.
 */
export type VizState =
  | "measured"
  | "declared"
  | "not-judged"
  | "missing"
  | "decided"
  | "superseded";

export const VIZ_STATES: readonly VizState[] = [
  "measured",
  "declared",
  "not-judged",
  "missing",
  "decided",
  "superseded",
];

/** Short human label — a legend row, a table cell, an aria-label fragment. Never a sentence. */
export const STATE_LABEL: Record<VizState, string> = {
  measured: "Measured",
  declared: "Declared, not enforced",
  "not-judged": "Not judged",
  missing: "No measurement",
  decided: "Decided by a human",
  superseded: "Superseded",
};

/**
 * The one-sentence caveat. This is where the demoted A2 prose lands: it is the `<title>` on the
 * shape, the tooltip on the legend row, and the body of a `WhyChip` — present on hover/focus,
 * absent at first sight. Each sentence below is the (D) Disclosed destination of a sentence that
 * used to sit permanently above a panel.
 */
export const STATE_HINT: Record<VizState, string> = {
  measured: "Observed directly at the last scan — a value we measured, not one that was claimed.",
  declared:
    "Declared in configuration but never observed being enforced — the perimeter exists on paper only.",
  "not-judged":
    "Not readable at the last observation: missing evidence, not a finding, and never counted as passing.",
  missing: "No measurement for this interval — an absence, never a zero.",
  decided:
    "A person decided this; the values around it are derived measurements, and the ring marks the decision.",
  superseded:
    "Superseded by a later record and kept rather than deleted, so the earlier decision stays auditable.",
};

// --- paint constants -----------------------------------------------------------------------

/** The id of the ONE hatch pattern. Render `<VizDefs/>` inside your `<svg>` to make it resolvable. */
export const HATCH_ID = "ascent-viz-hatch";
/** Hatch tile edge, in user units. 4-unit tile with a 2-unit stroke = the §2.4 "45° 2px hatch". */
export const HATCH_TILE = 4;
export const HATCH_STROKE = 2;

/** `declared` — outline only, dashed. The single dash array; never re-typed at a call site. */
export const DECLARED_DASH = "3 2";
/** `missing` — the broken-line mark used where a void still needs a legend swatch. */
export const VOID_DASH = "2 3";
/** `superseded` — 50% opacity plus a strikethrough rule. */
export const SUPERSEDED_OPACITY = 0.5;
/** Fallback paint when a caller has no score-derived colour. The one azure, per BRAND.md. */
export const DEFAULT_BASE = "var(--color-accent)";

/**
 * Kicker's treatment (mono, uppercase, wide-tracked) expressed for an SVG `<text>`, which needs
 * `fill-` rather than `text-` and cannot host the `<Kicker>` element itself. Defined once here so
 * axis/row labels across the kit stay one label voice — the PostureQuadrant/RadarChart precedent.
 */
export const KICKER_SVG_CLASS = "font-mono uppercase tracking-[0.18em] fill-slate-500";

function base(baseColor?: string): string {
  return baseColor && baseColor.length > 0 ? baseColor : DEFAULT_BASE;
}

/**
 * SVG `fill` paint for a state.
 * measured/decided/superseded → the base colour · declared/missing → `none` · not-judged → the hatch.
 * `missing` is `none` because a void must never read as a magnitude; most callers should skip the
 * shape entirely (see `isVoid`) rather than draw an invisible one.
 */
export function stateFill(state: VizState, baseColor?: string): string {
  switch (state) {
    case "measured":
    case "decided":
    case "superseded":
      return base(baseColor);
    case "not-judged":
      return `url(#${HATCH_ID})`;
    case "declared":
    case "missing":
      return "none";
  }
}

/**
 * SVG `stroke` paint for a state. `decided` returns the brand accent — that IS the ring around the
 * mark ("admission is the decision"); `not-judged` returns the hairline so a hatched cell still has
 * a boundary; `missing` returns `none` so a void draws nothing at all.
 */
export function stateStroke(state: VizState, baseColor?: string): string {
  switch (state) {
    case "measured":
    case "declared":
    case "superseded":
      return base(baseColor);
    case "not-judged":
      return "var(--color-divider)";
    case "decided":
      return "var(--color-accent)";
    case "missing":
      return "none";
  }
}

/** Fill opacity: full for a measurement, halved for a superseded one, zero where there is no fill. */
export function stateFillOpacity(state: VizState): number {
  switch (state) {
    case "measured":
    case "decided":
    case "not-judged":
      return 1;
    case "superseded":
      return SUPERSEDED_OPACITY;
    case "declared":
    case "missing":
      return 0;
  }
}

/** Group opacity — only `superseded` is dimmed; everything else renders at full strength. */
export function stateOpacity(state: VizState): number {
  return state === "superseded" ? SUPERSEDED_OPACITY : 1;
}

/** `stroke-dasharray` for a state, or undefined for a solid stroke. */
export function stateDash(state: VizState): string | undefined {
  if (state === "declared") return DECLARED_DASH;
  if (state === "missing") return VOID_DASH;
  return undefined;
}

/** `stroke-width`: the decided ring is heavier so it reads as a ring rather than an outline. */
export function stateStrokeWidth(state: VizState): number {
  return state === "decided" ? 2 : 1;
}

/**
 * Whether a numeric value may be printed beside the mark. FALSE for `not-judged` (a hatched cell
 * carries no value — "not judged, never as passing") and for `missing` (a void is not a zero).
 * This is the guard that stops the two states the prose used to protect from rendering a numeral.
 */
export function rendersValue(state: VizState): boolean {
  return state !== "not-judged" && state !== "missing";
}

/** True when the mark should not be drawn at all — a gap in the line, an empty cell. */
export function isVoid(state: VizState): boolean {
  return state === "missing";
}

/** True when the mark carries a strikethrough rule across it. */
export function isStruck(state: VizState): boolean {
  return state === "superseded";
}

/**
 * The generated `<title>` / tooltip text for a mark: subject, its state label, and the caveat. Built
 * from the same state the geometry is painted from, so the accessible text cannot drift from the
 * picture (the ProvenanceTrack discipline).
 */
export function stateTitle(state: VizState, subject?: string): string {
  const head = subject ? `${subject} — ${STATE_LABEL[state]}` : STATE_LABEL[state];
  return `${head}. ${STATE_HINT[state]}`;
}

/**
 * The shared `<defs>`: the ONE 45° hatch pattern. Render it once inside every `<svg>` that can paint
 * a `not-judged` mark — `url(#…)` resolves document-wide, and every instance is byte-identical, so a
 * page with several charts still has exactly one hatch definition in meaning.
 */
export function VizDefs(): ReactElement {
  return createElement(
    "defs",
    null,
    createElement(
      "pattern",
      {
        id: HATCH_ID,
        width: HATCH_TILE,
        height: HATCH_TILE,
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(45)",
      },
      createElement("rect", {
        width: HATCH_TILE,
        height: HATCH_TILE,
        fill: "var(--color-surface-strong)",
      }),
      createElement("line", {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: HATCH_TILE,
        stroke: "var(--color-divider)",
        strokeWidth: HATCH_STROKE,
      }),
    ),
  );
}
