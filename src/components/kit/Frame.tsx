// Frame: the v2 container, a hairline-ruled band with no fill and no radius. In Prism this is what a dashboard
// section is (the landing has no card boxes); Panel stays for focus objects. In Altimeter it renders as a
// plain ruled band too, so a module can adopt Frame in both themes and still read as the shipped app.
import type { ReactNode } from "react";

export type KitPattern = "grid" | "dots" | "hatch" | "spectral";
export type FrameEdge = "top" | "both" | "none";
const EDGE: Record<FrameEdge, string> = {
  top: "border-t border-divider",
  both: "border-y border-divider",
  none: "",
};
const PAD = { none: "", sm: "py-4", md: "py-6", lg: "py-9" } as const;

export function Frame({
  children,
  edge = "top",
  pad = "md",
  as: Tag = "section",
  id,
  className = "",
  pattern,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
}: {
  children: ReactNode;
  /** Which hairlines bound the band. `both` for a table shell (scroll containment stays visible). */
  edge?: FrameEdge;
  pad?: keyof typeof PAD;
  as?: "section" | "div" | "aside" | "header" | "footer";
  id?: string;
  className?: string;
  /** Prism background pattern (kit.css `data-pattern`); no effect in Altimeter. */
  pattern?: KitPattern;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Tag
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      data-kit="frame"
      data-edge={edge}
      data-pattern={pattern}
      data-role="frame"
      className={`${EDGE[edge]} ${PAD[pad]} ${id ? "scroll-mt-[calc(var(--header-h)+2.5rem)]" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
