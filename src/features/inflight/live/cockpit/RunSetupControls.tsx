"use client";

// THE SETUP DIALOG'S CONTROL VOCABULARY — four shapes, and the argument for each.
//
// The dials used to be ten stacked `<select>`s in an 18rem rail (CockpitRunControls, retired
// 2026-09-17). Every one of them was a dropdown regardless of what it held, so "2 lanes or 3" and
// "which of ninety minutes" were the same interaction, and each carried a paragraph of standing prose
// under it — the panel was more essay than instrument, in the narrowest column on the page.
//
//   • `SetupRow`   — one dial: its label, an optional InfoTip carrying the paragraph that used to sit
//                    under the control, and the control itself. The explanation keeps its place in
//                    the product and loses its place on the page.
//   • `Segmented`  — a value picked from a SHORT closed list (≤ ~8). Every option is on screen, so
//                    choosing is one click and comparing is free. A disabled option keeps its seat and
//                    states its reason: an unavailable mode must read as unavailable, not as absent.
//   • `NumberRow`  — `Segmented` over 1..cap. The caps here are 4, 5, 8 and 12, which fit.
//   • `ChoiceList` — the fallback for a list too long to lay out (the minute bands): a plain select,
//                    the same brand control as everywhere else.
//
// CAPS ARE THE SERVER'S OWN CONSTANTS, never numbers typed here — the route rejects anything above
// them, and a picker that can express a rejected value is a bug. That rule is inherited unchanged from
// the retired panel and is the one thing about it that was never the problem.

import { InfoTip, SelectInput } from "@/components/ui";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  /** Offered but not choosable, with the reason ON the option — never silently dropped. */
  disabled?: boolean;
  /** Hover/AT detail for an abbreviated label. */
  title?: string;
}

export function SetupRow({
  label,
  info,
  children,
  className = "",
}: {
  label: string;
  /** The paragraph this dial used to carry inline. Omitted for a dial that needs no essay. */
  info?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="flex items-center gap-1.5">
        <span className="type-label tracking-[0.18em] text-slate-500">{label}</span>
        {info && <InfoTip label={label.toLowerCase()}>{info}</InfoTip>}
      </span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} data-testid={testId} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`focus-ring rounded-lg border px-2.5 py-1.5 type-body-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              on
                ? "border-accent bg-accent/15 font-medium text-white"
                : "border-divider bg-surface/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** `Segmented` over 1..cap, with the deployment's default marked where it falls. */
export function NumberRow({
  value,
  cap,
  onChange,
  ariaLabel,
  defaultValue,
  testId,
}: {
  value: number;
  cap: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  /** Marked with a dot rather than the word "default", which doubles the width of every option. */
  defaultValue?: number;
  testId?: string;
}) {
  const options = Array.from({ length: cap }, (_, i): SegmentedOption<number> => {
    const n = i + 1;
    return { value: n, label: n === defaultValue ? `${n}·` : String(n), title: n === defaultValue ? `${n} — the default` : undefined };
  });
  return <Segmented value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} testId={testId} />;
}

/** The select fallback, for a band too long to lay out flat (the minute ranges). */
export function ChoiceList<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  testId,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (raw: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <SelectInput
      aria-label={ariaLabel}
      data-testid={testId}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </SelectInput>
  );
}
