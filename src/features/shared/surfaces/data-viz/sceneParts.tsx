"use client";

// Shared markup for the data-viz scene's regions: the `data-technique` boundary the frame spotlights,
// the small labelled readouts, the chip row every region uses to switch policy, and the button skins.
// `Chips` carries click handlers, which is why this file is a client module.

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

/** A radio-like chip row: one selected value, `aria-pressed` on each chip. */
export function Chips<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onPick: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={o.id === value ? BTN_ON : BTN} aria-pressed={o.id === value} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The axis predicate, printed where the eye is: what was counted, over what window, in what unit. */
export function AxisPredicate({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 type-caption text-slate-500">{children}</p>;
}
