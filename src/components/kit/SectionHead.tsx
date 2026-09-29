// SectionHead: the landing sec-head. Eyebrow (tick) + statement (300, one named phrase 600) + lede.
import type { ReactNode } from "react";
import { Display, Eyebrow, Lede, type DisplayLevel } from "./Type";

export function SectionHead({
  eyebrow,
  title,
  named,
  lede,
  level = "section",
  as = "h2",
  actions,
  id,
  className = "",
}: {
  eyebrow?: ReactNode;
  /** The light statement. */
  title: ReactNode;
  /** The named phrase set heavier at the end of the statement. */
  named?: ReactNode;
  lede?: ReactNode;
  level?: DisplayLevel;
  as?: "h1" | "h2" | "h3";
  /** Right-aligned controls (segmented range, primary action). */
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <header data-kit="section-head" data-role="section-head" className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${className}`}>
      <div className="min-w-0 max-w-[58ch]">
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <Display as={as} level={level} named={named} id={id}>
          {title}
        </Display>
        {lede && <Lede className="mt-3">{lede}</Lede>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </header>
  );
}
