// Masthead: the one dominant element of a working surface. A page-level statement (one light phrase, one
// named), an optional lede, and a ruled row of supporting figures with an aside (a trend, a clock). It is the
// dashboard form of the landing's stage headline: the surface's answer in display type first, the evidence in
// smaller figures beside it. Server-safe. A figure the surface did not measure passes its own caveat in `detail`.
import type { ReactNode } from "react";
import type { KitPattern } from "./Frame";
import { Caption, Display, Eyebrow, Lede } from "./Type";

export type MastheadTone = "good" | "watch" | "risk";
// Status travels by glyph and word, never by hue (the hue-versus-meaning ruling, KIT-HANDOFF.md): a shape in
// front of the value, its word for screen readers, and paper for the number itself.
const TONE: Record<MastheadTone, { glyph: string; word: string }> = {
  good: { glyph: "✓", word: "Healthy" },
  watch: { glyph: "◆", word: "Watch" },
  risk: { glyph: "▲", word: "At risk" },
};

export interface MastheadFigure {
  label: ReactNode;
  value: ReactNode;
  /** Status of the value, drawn as `data-tone` + a leading glyph + a screen-reader word; the value stays paper. */
  tone?: MastheadTone;
  /** Colour for the value. Kept for Altimeter callers; a v2 caller passes `tone` instead (hue names a dimension). */
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
                <span title={f.title} data-tone={f.tone} style={f.color && !f.tone ? { color: f.color } : undefined}>
                  {f.tone && (
                    <>
                      <span aria-hidden data-role="tone-glyph" className="mr-1.5 align-middle text-[0.45em]">
                        {TONE[f.tone].glyph}
                      </span>
                      <span className="sr-only">{TONE[f.tone].word}: </span>
                    </>
                  )}
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
