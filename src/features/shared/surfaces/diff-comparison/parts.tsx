// Shared markup for the comparison desk's regions. No hooks, no "use client": a Region is the
// `data-technique` boundary the frame spotlights; Readout, Chip and the cell skins are the small
// vocabulary every panel shares so seven regions read as one surface.

import { Kicker } from "@/components/ui";
import { CHANGE_KINDS, type ChangeKind } from "./kernel";

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
export const TD = "border-t border-divider py-1.5 pr-3 align-top";

/** A pressed/unpressed toggle chip; `aria-pressed` carries the state for assistive readers. */
export function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" className={on ? BTN_ON : BTN} aria-pressed={on} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** The change-kind mark: glyph as CONTENT (announced, copyable by design), colour beside it. */
export function KindMark({ kind }: { kind: ChangeKind }) {
  const k = CHANGE_KINDS[kind];
  return (
    <span className={`inline-flex items-center gap-1 type-mono-sm ${k.tone}`} data-kind={kind}>
      <span aria-hidden className="w-3 text-center">{k.glyph}</span>
      <span className="type-micro uppercase tracking-[0.12em]">{k.label}</span>
    </span>
  );
}

/** Notice skins for the three states a comparison surface must keep apart. */
export const NOTICE = {
  info: "rounded-lg border border-divider bg-surface/40 px-3 py-2 type-caption text-slate-400",
  failure: "rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 type-caption text-danger-soft",
  cut: "rounded-md border border-dashed border-warn/60 px-3 py-1.5 type-caption text-warn",
};
