import type { CSSProperties } from "react";

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
