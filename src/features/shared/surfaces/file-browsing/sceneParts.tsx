// Shared markup for the vault browser's regions. No hooks, no "use client": a Region is the
// `data-technique` boundary the frame spotlights; Readout is the labelled figure the panels share.

import { Kicker } from "@/components/ui";
import { KINDS, type Kind } from "./kinds";

export function Region({ technique, title, note, children, className = "" }: { technique: string; title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section data-technique={technique} className={`rounded-xl border border-divider bg-ink p-4 ${className}`} aria-label={title}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-body-sm font-semibold text-white">{title}</h3>
        <span className="type-caption text-slate-600">{technique}</span>
      </div>
      {note ? <p className="mb-3 type-caption text-slate-500">{note}</p> : null}
      {children}
    </section>
  );
}

export function Readout({ label, value, tone = "text-slate-200" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Kicker tone="muted" as="span">
        {label}
      </Kicker>
      <span className={`type-mono-sm tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

/** The kind glyph — rung 1 of the preview ladder, derived from the one vocabulary. */
export function KindGlyph({ kind }: { kind: Kind }) {
  return (
    <span className="inline-block w-5 text-center type-mono-sm text-slate-500" aria-label={KINDS[kind].label} title={KINDS[kind].label}>
      {KINDS[kind].glyph}
    </span>
  );
}

export const BTN = "focus-ring rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-40";
export const BTN_ON = "focus-ring rounded-md border border-accent bg-accent/10 px-2 py-1 type-caption text-accent-soft";
