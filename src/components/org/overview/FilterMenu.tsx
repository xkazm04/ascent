"use client";

// A header filter dropdown for the fleet views. A funnel icon opens a menu of that dimension's values
// (sorted name-ascending), each a toggle; a Clear resets it. Replaces the old inline chip tray — the
// filter now lives in the view header, opened on demand. Closes on outside-click or Escape.
//
// Keyboard contract (the WAI-ARIA multi-select listbox model the roles promise): opening moves focus
// into the list (first selected option, else first option); ArrowUp/ArrowDown move with wrap-around;
// Home/End jump to the edges; Enter/Space toggle (native button click); Escape closes AND returns
// focus to the trigger. Options use a roving tabindex so Tab leaves the widget rather than crawling it.

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
  // Roving-tabindex cursor: which option holds tabIndex=0 (and DOM focus while navigating).
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const count = selected.size;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Options sorted by name ascending — a stable, scannable list regardless of data order.
  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label));

  // On open, move focus into the listbox so arrow navigation starts immediately instead of focus
  // staying behind the popup on the trigger. The cursor POSITION is chosen in the open handler (an
  // event, not an effect — see `openMenu`); this effect only pushes it into the DOM, which is the
  // external system an effect is meant to synchronize with.
  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIdx]?.focus();
    // Only on open — re-running as activeIdx changes would fight the keyboard handler's own focus()
    // calls and yank focus off the option being toggled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Anchor the roving cursor on the first selected option (the user's likely reference point), else
  // the first option. Computed here rather than in an effect: the value is knowable at the moment of
  // opening, so deriving it after paint would cost an extra cascading render every time.
  const openMenu = () => {
    const firstSelected = sorted.findIndex((o) => selected.has(o.value));
    setActiveIdx(firstSelected >= 0 ? firstSelected : 0);
    setOpen(true);
  };

  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveTo = (idx: number) => {
    if (sorted.length === 0) return;
    const next = (idx + sorted.length) % sorted.length;
    setActiveIdx(next);
    optionRefs.current[next]?.focus();
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveTo(activeIdx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveTo(activeIdx - 1);
        break;
      case "Home":
        e.preventDefault();
        moveTo(0);
        break;
      case "End":
        e.preventDefault();
        moveTo(sorted.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        closeAndRefocus();
        break;
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          // Escape on the (still-focused) trigger while the popup is open must also dismiss it —
          // previously a document-level listener closed it but stranded focus wherever it was.
          if (e.key === "Escape" && open) {
            e.preventDefault();
            closeAndRefocus();
          }
        }}
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
          aria-label={`Filter by ${label}`}
          aria-multiselectable="true"
          onKeyDown={onListKeyDown}
          className="absolute left-0 top-full z-20 mt-1 min-w-[13rem] rounded-xl border border-divider bg-surface-strong/95 p-1 shadow-xl backdrop-blur"
        >
          {sorted.length === 0 ? (
            <p className="px-2 py-1.5 font-mono text-xs text-slate-500">No values.</p>
          ) : (
            sorted.map((o, i) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={on}
                  tabIndex={i === activeIdx ? 0 : -1}
                  onClick={() => onToggle(o.value)}
                  onFocus={() => setActiveIdx(i)}
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
              onKeyDown={(e) => {
                // The Clear row is Tab-reachable (not part of the option roving order); Escape here
                // must still dismiss + refocus like everywhere else in the popup.
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeAndRefocus();
                }
              }}
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
