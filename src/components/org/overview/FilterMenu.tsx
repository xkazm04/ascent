"use client";

// A header filter dropdown for the fleet views. A funnel icon opens a menu of that dimension's values
// (sorted name-ascending), each a toggle; a Clear resets it. Replaces the old inline chip tray — the
// filter now lives in the view header, opened on demand. Closes on outside-click or Escape.

import { useEffect, useRef, useState } from "react";
import { FilterIcon, ChevronDownIcon, CheckIcon } from "@/components/org/overview/orgIcons";

export interface FilterOption {
  value: string;
  label: string;
  /** Small leading glyph — a type dot, a stack icon, or a level glyph. */
  leading?: React.ReactNode;
}

export function FilterMenu({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = selected.size;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Options sorted by name ascending — a stable, scannable list regardless of data order.
  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`focus-ring inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${
          count > 0 || open ? "border-accent/60 text-white" : "border-divider text-slate-400 hover:border-accent hover:text-white"
        }`}
      >
        <FilterIcon />
        {label}
        {count > 0 && <span className="rounded-full bg-accent/20 px-1.5 text-accent">{count}</span>}
        <ChevronDownIcon className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 min-w-[13rem] rounded-xl border border-divider bg-surface-strong/95 p-1 shadow-xl backdrop-blur"
        >
          {sorted.length === 0 ? (
            <p className="px-2 py-1.5 font-mono text-xs text-slate-500">No values.</p>
          ) : (
            sorted.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => onToggle(o.value)}
                  className={`focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-sm transition ${
                    on ? "bg-accent/10 text-white" : "text-slate-300 hover:bg-surface/60"
                  }`}
                >
                  <span className="flex w-4 shrink-0 justify-center text-accent">{on ? <CheckIcon /> : null}</span>
                  {o.leading && <span className="flex w-4 shrink-0 justify-center">{o.leading}</span>}
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })
          )}
          {count > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="focus-ring mt-1 w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs uppercase tracking-widest text-slate-500 hover:text-accent"
            >
              Clear {label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
