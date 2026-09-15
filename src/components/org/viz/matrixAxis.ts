// Axis-header wrapping for MatrixGrid.
//
// SVG <text> does not clip or wrap: a label wider than its column silently overlaps the next one.
// Reported from Wave 4 of the /org redesign against Wave 1's own ["Counted here", "Per-person row"]
// privacy matrix, which had been shipping overlapped.
//
// Pure and separately tested because the geometry depends on it: the header band's height is a
// function of the tallest wrapped label, so a wrapping bug is a layout bug, not a typographic one.

/**
 * Axis headers get their own type treatment rather than the shared `KICKER_SVG_CLASS`.
 *
 * The Kicker face is `tracking-[0.18em]`, which at font-size 9 costs ~1.6 units per character on top
 * of the ~5.4-unit mono advance — about 7 units a glyph, so a 46-unit column fits barely SIX. That is
 * narrower than `MatrixGrid`'s own canonical axis names ("Declared" / "Observed" / "Enforced", all
 * eight), i.e. the component could not render the labels it is documented around without wrapping
 * them. Wide tracking is a treatment for standalone eyebrows; a dense chart header is the deliberate
 * exception (BRAND.md keeps tracking on the element for exactly this reason), so the axis keeps the
 * mono uppercase voice and drops most of the letter-spacing.
 */
export const AXIS_SVG_CLASS = "font-mono uppercase tracking-[0.04em] fill-slate-500";

/** Characters that fit one 46-unit column at font-size 9 in {@link AXIS_SVG_CLASS}. Deliberately
 *  conservative: an overhang of one glyph reads as a collision, a little slack does not. */
export const AXIS_MAX_CHARS = 8;

/** Two lines is the ceiling: a three-line header pushes the first row far enough down that the grid
 *  stops reading as a grid. A label that still does not fit is ellipsized — the FULL text always
 *  survives in the SVG's aria-label, the header's own <title> and the sr-only table, so nothing is
 *  lost to a reader who needs it. Axis names are expected to be short; this is the honest fallback,
 *  not a licence for sentences. */
export const AXIS_MAX_LINES = 2;

/** Break opportunities: whitespace, and after a hyphen (so "Per-person" can split as "Per-" +
 *  "person" rather than mid-morpheme). */
function tokens(label: string): string[] {
  return label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => w.split(/(?<=-)/))
    .filter(Boolean);
}

/**
 * Break one axis label into at most {@link AXIS_MAX_LINES} lines of at most `maxChars` each.
 *
 * Greedy packing over {@link tokens}; a single token still wider than the column is hard-split rather
 * than allowed to overhang. When the label cannot be shown in the available lines the last line is
 * ellipsized with `…` — never silently truncated, so a reader can tell there is more.
 */
export function wrapAxisLabel(
  label: string,
  maxChars: number = AXIS_MAX_CHARS,
  maxLines: number = AXIS_MAX_LINES,
): string[] {
  const words = tokens(label);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    let w = word;
    // A token wider than the column can never be packed; break it so it cannot overhang.
    while (w.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!w) continue;
    // A token ending in a hyphen joins the next one without a space ("Per-" + "person").
    const joiner = line.endsWith("-") ? "" : " ";
    const candidate = line ? `${line}${joiner}${w}` : w;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  return kept;
}

/** Header band height for a set of wrapped axis labels: one line box per line, plus the rule's pad.
 *  A single-line header keeps the 18 units the grid shipped with, so no existing matrix shifts. */
export function axisHeaderHeight(wrapped: string[][], lineH = 10, pad = 8): number {
  const tallest = Math.max(1, ...wrapped.map((w) => w.length));
  return pad + tallest * lineH;
}
