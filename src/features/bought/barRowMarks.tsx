// The marks shared by the bought group's "label | proportional bar | mono readout" rows. Server-safe.
//
// These rows used to be one SVG each, with a `viewBox`, so their text scaled with the panel: tiny in
// a narrow column, huge in a wide one, and titles cut by character count to fit a fixed gutter. The
// Ledger direction (MatrixGrid) fixed the same flaw by laying every glyph out in HTML, in the
// semantic `type-*` scale, and keeping SVG only for the MARK. These are the pieces of that mark: an
// SVG with no viewBox, so its user units are CSS pixels and its x-coordinates are percentages of the
// HTML cell that sizes it. Strokes and dashes therefore never distort, whatever the panel width.

import type { ReactNode } from "react";
import { VOID_DASH, r2 } from "@/components/org/viz";

/** A 0..100 share as an SVG percentage length: the cell, not a viewBox, owns the geometry. */
export const pctLen = (v: number): string => `${r2(v)}%`;

/** The Ledger column head: mono, uppercase, tracked. The caller puts the row on the one hairline. */
export const COLUMN_HEAD = "type-micro font-mono uppercase tracking-[0.18em] text-slate-500";

/** The SVG a mark is drawn in. No viewBox: sized by its HTML cell through `className`. */
export function MarkSvg({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <svg aria-hidden focusable="false" className={`block w-full overflow-visible ${className}`}>
      {children}
    </svg>
  );
}

/**
 * The void: a dashed rule where a bar would be, across `from`..`to` percent of the cell, vertically
 * centred. It marks the row without asserting a magnitude, and nothing here can print a numeral.
 */
export function VoidRule({
  id,
  from = 0,
  to = 100,
}: {
  /** Value for the `data-void` hook; a bare presence marker when omitted. */
  id?: string;
  from?: number;
  to?: number;
}) {
  return (
    <line
      data-void={id ?? true}
      x1={pctLen(from)}
      y1="50%"
      x2={pctLen(to)}
      y2="50%"
      stroke="var(--color-divider)"
      strokeWidth={1}
      strokeDasharray={VOID_DASH}
    />
  );
}
