import type { CSSProperties } from "react";

import { chipLeft, splitLoc } from "./devLocate";

export const Z = 2147483646;
export const ACCENT = "#38bdf8"; // cyan
export const DIM = "#a855f7"; // purple — secondary (pointed) outline
export const OK = "#34d399"; // green — copy confirmation

function boxStyle(rect: DOMRect, color: string, dashed: boolean): CSSProperties {
  return {
    position: "fixed",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    border: `${dashed ? 1 : 2}px ${dashed ? "dashed" : "solid"} ${color}`,
    borderRadius: 3,
    background: dashed ? "transparent" : `${color}1f`,
    pointerEvents: "none",
    boxSizing: "border-box",
    zIndex: Z,
  };
}

export function HighlightBox({ rect, variant }: { rect: DOMRect; variant: "target" | "pointer" }) {
  return <div style={boxStyle(rect, variant === "target" ? ACCENT : DIM, variant === "pointer")} />;
}

// Chip layout invariants, named so the placement math and the CSS enforce the SAME numbers.
// CHIP_H: rendered chip height (11px font × 1.4 line-height + 2×1px padding ≈ 17px, rounded up with
// margin) — drives the flip-above/below threshold and the vertical offsets. CHIP_MAX_W: the widest
// the chip may render; maxWidth + ellipsis below ENFORCE it (previously the chip was nowrap with no
// maxWidth, so a long `SomeVeryLongComponentName.tsx:1234` overflowed the right edge). The `left`
// clamp uses the chip's ESTIMATED OWN width (chipLeft) rather than this ceiling — clamping a short
// label against 260px pushed it far from the element it labels near the right edge.
const CHIP_H = 20;
const CHIP_MAX_W = 260;

/** A compact `File.tsx:line` chip pinned to the cursor's element. */
export function SourceLabel({ rect, loc }: { rect: DOMRect; loc: string }) {
  const { file } = splitLoc(loc);
  const above = rect.top > CHIP_H + 2; // room for the chip (+2px gap) above the box?
  const top = above ? rect.top - CHIP_H : Math.min(rect.top + 2, window.innerHeight - (CHIP_H + 2));
  const left = chipLeft(rect.left, file, window.innerWidth, { maxWidth: CHIP_MAX_W });
  return (
    <div
      style={{
        position: "fixed",
        top,
        left,
        zIndex: Z,
        pointerEvents: "none",
        font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#0b1220",
        background: ACCENT,
        borderRadius: 4,
        padding: "1px 6px",
        fontWeight: 700,
        whiteSpace: "nowrap",
        maxWidth: CHIP_MAX_W,
        overflow: "hidden",
        textOverflow: "ellipsis",
        boxSizing: "border-box",
        boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
      }}
    >
      {file}
    </div>
  );
}
