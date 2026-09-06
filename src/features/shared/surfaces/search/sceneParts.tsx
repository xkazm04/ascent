// Shared markup for the search scene's regions. No hooks, no "use client": a Region is the
// `data-technique` boundary the frame spotlights, plus the small labelled readouts and the chip the
// panels share.

import { Kicker } from "@/components/ui";

export function Region({ technique, title, note, children, className = "" }: { technique: string; title: string; note?: string; children: React.ReactNode; className?: string }) {
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

/** A removable clause chip: the thing itself is the deletion affordance. */
export function Chip({ children, onRemove, tone = "idle", title }: { children: React.ReactNode; onRemove?: () => void; tone?: "idle" | "warn" | "danger" | "default"; title?: string }) {
  const skin = tone === "warn" ? "border-warn/60 text-warn" : tone === "danger" ? "border-danger/60 text-danger" : tone === "default" ? "border-divider text-slate-500" : "border-slate-700 text-slate-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 type-caption ${skin}`} title={title}>
      {children}
      {onRemove ? (
        <button type="button" className="focus-ring rounded-full px-1 text-slate-500 hover:text-white" onClick={onRemove} aria-label="Remove clause">
          ×
        </button>
      ) : null}
    </span>
  );
}

export const BTN = "focus-ring rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-40";
export const BTN_ON = "focus-ring rounded-md border border-accent bg-accent/10 px-2 py-1 type-caption text-accent-soft";
export const toggleClass = (on: boolean) => (on ? BTN_ON : BTN);
