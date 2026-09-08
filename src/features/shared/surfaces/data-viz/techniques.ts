// The drawer entries for the data-viz scene: one per technique of the registry's `data-viz` subject
// (authored against sha256:b6657691892c6b9b, 2026-09-06), in the golden path's order. `mechanism`
// explains what the region does in React/Tailwind/Motion; `source` is the scene's own code;
// `inAscent` cites a real Ascent file that was read; `deviation` names where Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "metric-identity",
    title: "Metric identity",
    mechanism:
      "metrics.ts is a registry: each entry carries the whole contract — id, label, unit, precision, polarity, window, source — and the ONE `derive()` that computes it, returning null for an empty denominator rather than a fabricated 0. " +
      "The tile, the daily strip, the table cell and the tooltip line all call `readMetric()` and `fmtMetric()`; none holds a sum or a divide of its own, so switching the variant chip moves four surfaces with one number. " +
      "The 7d and 14d variants are registered divergence: two ids, one computation, each stating its window beside the value; the 14d variant has no previous window, so its delta is a dash. " +
      "Polarity is read from the record at the moment a delta is coloured: `favourable()` flips the sign for lower-better metrics and `deltaHex` colours the result, so a rising failed-scan count arrows up in orange.",
    source: S.SRC_METRIC,
    inAscent: {
      file: "src/components/ui/format.ts",
      note: "`DIRECTION_TONE` / `toneFor` / `fmtDelta` are the one authority for delta tone and format (noise-muted, NaN → '—'), imported by every fleet surface that shows a change.",
    },
    deviation:
      "No metric registry exists: fleet-level derivations (success rate, per-day averages) live where each surface computes them, with no record of unit, window, source or polarity a second surface could import.",
  },
  {
    slug: "scale-and-axis-design",
    title: "Scale and axis design",
    mechanism:
      "`project()` in chartMath.ts takes the domain as a required argument, so a sample-anchored floor cannot be written through the sanctioned door by accident — it has to be requested as the `sample-floor` policy, which the chips label a defect. " +
      "Four sibling panels of the same metric redraw under the chosen policy; the readout shows how many score points the steady series' domain spans, and turns `text-danger` when two of them fill the whole box. " +
      "`auto` keeps a zero floor and rounds the ceiling to a 25 (`niceCeil`), so ticks land on the data's round numbers; the partial trailing bucket is dashed, hollow, and never sets a ceiling. " +
      "The axis predicate is printed under the panels — what was measured, over what window, in what unit, in which timezone — and the scale answers 'why this scale' in words.",
    source: S.SRC_SCALE,
    inAscent: {
      file: "src/components/report/chartScale.ts",
      note: "`vScale` fixes the 0..100 score domain for every report chart and `linScale` demands `domainMax`; `BAND_EDGES` puts ticks on the level boundaries, so TrendChart, DimLine and Sparkline share one declared scale.",
    },
    deviation:
      "`src/components/org/shared/GoalTrend.tsx` derives its floor from `Math.min(...values, target)` — the sample-anchored floor — so a goal card's line fills its box on sub-noise movement; and no chart marks its trailing bucket as partial.",
  },
  {
    slug: "chart-loading-economics",
    title: "Chart loading economics",
    mechanism:
      "Three slots render at final height (`h-24`) before anything arrives; the engine is a simulated deferred chunk requested once by the first button and shared by every slot, its timeout cleared in the effect's cleanup. " +
      "While engine and data wait, one calm placeholder holds the geometry: it fades in after a 150ms delay via `animation-fill-mode: both`, so a warm path never flashes it, and under `reduced` it simply sits there. " +
      "Each slot is wrapped in `ChartBoundary`, a class component whose `componentDidCatch` reports the chart's identity and the data shape that threw; poisoning series B throws inside its render and only slot B degrades to a failure state, siblings still drawing. " +
      "Retry bumps `resetKey`, which `getDerivedStateFromProps` reads to clear the error, so the boundary is not sticky across a data change.",
    source: S.SRC_LOADING,
    inAscent: {
      file: "src/components/ui/Defer.tsx",
      note: "`strategy=\"visible\"` mounts a subtree only when its sentinel nears the viewport (240px early), one-shot with the observer disconnected on first intersection and released in cleanup; `placeholder` reserves the geometry.",
    },
    deviation:
      "`Defer`'s `placeholder` defaults to null, so most call sites reserve no height; the only error boundaries are per tab (`OrgTabErrorBoundary`) and per report, not per chart — one malformed series still blanks a whole panel.",
  },
  {
    slug: "micro-visualizations",
    title: "Micro-visualizations",
    mechanism:
      "A sparkline column inside a repository table: the header names the metric and window (`overall · daily · 14d`) because the glyph carries no chrome, and the current score sits beside the glyph as a number the glyph rides next to, never instead of. " +
      "Every cell shares `SCORE_DOMAIN` and the same 15 buckets; the chip that switches to per-cell auto-scale is labelled a defect, and flipping it makes the steady and the volatile rows look alike. " +
      "`MIN_POINTS_FOR_SHAPE` is 3: a row with fewer measured observations renders 'collecting · n of 3' instead of a two-point slope, and its delta is a dash. " +
      "A gap inside a cell is still a shaded unmeasured band at 20px tall; hue is the score ramp the badges use; there is no per-cell entrance animation and rows keep a fixed height.",
    source: S.SRC_MICRO,
    inAscent: {
      file: "src/components/report/TrendChart.Sparkline.tsx",
      note: "The report's inline sparkline uses `vScale` on the fixed 0..100 domain with a reference line at the L4 band edge, and draws its path only when `points.length > 1`.",
    },
    deviation:
      "The Sparkline still draws a line at two points, and `GoalTrend.tsx` auto-scales each card's sparkline to its own sample; no shared minimum-observation floor exists.",
  },
  {
    slug: "encoding-vocabulary",
    title: "Encoding vocabulary",
    mechanism:
      "`seriesColor(id)` maps the number minted in a repo's id into the product's categorical palette (`STACK_COLORS`), so re-sorting the fleet moves the lines and not their colours; the legend's `data-color` proves it. " +
      "The chips choose what colour carries: identity (hue per series, status on the label) or status (the same `LEVEL_HEX` ramp the badges use, identity moved to the direct label at the line's end) — never both on one chart. " +
      "The end-mark shape and the direct label are the non-hue channels; the grayscale check applies `filter: grayscale(1)` to the chart and its legend so the audit is a click. " +
      "`PALETTE_CAPACITY` is declared and `aliases()` detects the modulo wrap, so the readout can say when the series count must be capped to top-N plus other.",
    source: S.SRC_ENCODING,
    inAscent: {
      file: "src/lib/ui.ts",
      note: "`LEVEL_HEX` / `scoreHex` are the one score ramp for rings, charts, heatmap and level pills (`LEVEL_CLASSES` locked to the same stops), and `LEVEL_GLYPH` is the redundant non-colour channel.",
    },
    deviation:
      "The categorical identity palette lives in a feature file (`src/features/standing/tech-stacks/stackViz.ts` `STACK_COLORS`), not in `@/lib/ui` beside the score ramp, and `stackColor(i)` assigns it by index — a re-sort recolours the stacks.",
  },
  {
    slug: "empty-and-degraded-chart-states",
    title: "Empty and degraded chart states",
    mechanism:
      "One reserved slot walks eight facts; `MiniLine` with `chrome` is rendered only for the three that hold data, and every empty renders `data-chrome=\"none\"` — no gridline, no tick, no zero line around nothing. " +
      "Nothing-yet, nothing-in-window, not-measured and could-not-answer each get their own copy and next action: the window empty offers to widen, the not-measured one says waiting will not help, the failure keeps the window and offers retry in a `role=\"alert\"`. " +
      "Inside a populated chart the taxonomy recurs: `runs()` breaks the line at every null bucket and `gaps()` shades the unmeasured stretch, so days 5–8 are neither a plunge to zero nor a bridge. " +
      "A series with two observations draws points and the number and no line; the trailing partial bucket is dashed and hollow in every state that draws.",
    source: S.SRC_STATES,
    inAscent: {
      file: "src/components/report/RadarFallback.tsx",
      note: "Under three dimensions the radar degrades to labelled bars rather than an invisible polygon or a 'No dimension data' lie, and a zero renders as an empty track with an explicit 'Zero: nothing detected' line.",
    },
    deviation:
      "The report's series format has no 'not measured' value — `reportSeries.ts` drops an absent dimension from the series (a shorter line, not a gap) — and no chart distinguishes 'nothing in window' from 'not being measured' from 'failed'.",
  },
];
