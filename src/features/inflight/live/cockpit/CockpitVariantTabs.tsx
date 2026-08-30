"use client";

// PROTOTYPE SCAFFOLD — the tab strip that A/Bs the outcome surface. Throwaway: removed when a
// variant wins (see .claude/skills/prototype).

import type { OutcomeVariant } from "../outcome/OutcomeSection";

export type CockpitVariant = "baseline" | OutcomeVariant;

const TABS: readonly { id: CockpitVariant; label: string }[] = [
  { id: "baseline", label: "Baseline" },
  { id: "storyboard", label: "Storyboard" },
];

export function CockpitVariantTabs({ value, onChange }: { value: CockpitVariant; onChange: (v: CockpitVariant) => void }) {
  return (
    <div role="tablist" aria-label="Outcome prototype variant" className="flex w-fit gap-px overflow-hidden rounded-md border border-divider bg-divider">
      {TABS.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`focus-ring type-label px-2.5 py-1 tracking-[0.18em] ${on ? "bg-accent/10 text-accent" : "bg-ink text-slate-500 hover:text-slate-300"}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
