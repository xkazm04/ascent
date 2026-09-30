// Masthead: the one dominant element of a working surface. A page-level statement (one light phrase, one
// named), an optional lede, and a ruled row of supporting figures with an aside (a trend, a clock). It is the
// dashboard form of the landing's stage headline: the surface's answer in display type first, the evidence in
// smaller figures beside it. Server-safe. A figure the surface did not measure passes its own caveat in `detail`.
import type { ReactNode } from "react";
import type { KitPattern } from "./Frame";
import { Caption, Display, Eyebrow, Lede } from "./Type";

export interface MastheadFigure {
  label: ReactNode;
  value: ReactNode;
  /** Colour for the value (a status colour, never a decorative hue). */
  color?: string;
  /** Beneath the value: movement with its basis, an exclusion note, a goal. */
  detail?: ReactNode;
  /** Tooltip naming what the value was measured over. */
  title?: string;
}

export function Masthead({
  eyebrow,
  statement,
  named,
  lede,
  figures = [],
  aside,
  pattern,
  className = "",
}: {
  eyebrow?: ReactNode;
  statement: ReactNode;
  named?: ReactNode;
  lede?: ReactNode;
  figures?: MastheadFigure[];
  aside?: ReactNode;
  /** Prism background pattern (`spectral` suits a masthead); no effect in Altimeter. */
  pattern?: KitPattern;
  className?: string;
}) {
  return (
    <header data-kit="masthead" data-role="masthead" data-pattern={pattern} className={className}>
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <Display as="h1" level="page" named={named}>
        {statement}
      </Display>
      {lede && <Lede className="mt-3">{lede}</Lede>}
      {(figures.length > 0 || aside) && (
        <div data-role="masthead-figures" className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-5 border-t border-divider pt-5">
          {figures.map((f, i) => (
            <div key={i} data-role="masthead-figure" className="min-w-0">
              <Caption>{f.label}</Caption>
              <Display as="div" level="figure" className="mt-1">
                <span title={f.title} style={f.color ? { color: f.color } : undefined}>
                  {f.value}
                </span>
              </Display>
              {f.detail && <div className="mt-1 type-caption text-slate-400">{f.detail}</div>}
            </div>
          ))}
          {aside && (
            <div data-role="masthead-aside" className="ml-auto min-w-0">
              {aside}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
