// Shared markup for the fleet desk's regions. No hooks, no "use client": a Region is the
// `data-technique` boundary the frame spotlights, plus the labelled readouts and button skins the
// panels share (the same shapes the sibling scenes use).

import { Kicker } from "@/components/ui";

export function Region({
  technique,
  title,
  note,
  children,
  className = "",
}: {
  technique: string;
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section data-technique={technique} className={`rounded-xl border border-divider bg-ink p-4 ${className}`} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
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

export const BTN = "focus-ring rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-40";
export const BTN_ON = "focus-ring rounded-md border border-accent bg-accent/10 px-2 py-1 type-caption text-accent-soft";
export const TH = "py-1 pr-3 text-left font-normal";
export const TD = "border-t border-divider py-1 pr-3 align-top";
