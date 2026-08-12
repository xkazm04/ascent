"use client";

// PROTOTYPE SCAFFOLD, consolidated — Half-life won the Context Health round; Prompt Audit and
// Map-vs-Territory are deleted. This panel is ADDITIVE to the shipped Repositories tab, so its
// "Baseline" is the panel hidden — and Baseline STAYS the default because Half-life still runs on
// the clearly-labeled contextHealthMock synthesis. It becomes the render once the real per-file
// context signals land (see the data-model notes in contextHealthMock.ts). Data is fetched by the
// SERVER panel (ContextHealthPanel.tsx) and handed down as props — the `await` never moves into
// this client component.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import type { RepoContextHealth } from "./contextHealthMock";
import { ContextHalfLife } from "./ContextHalfLife";

export interface ContextVariantProps {
  slug: string;
  rows: RepoContextHealth[];
}

const VARIANTS = [
  { id: "baseline", label: "Baseline", note: "the tab as shipped — panel hidden" },
  { id: "half-life", label: "Half-life", note: "decay under churn" },
] as const;

type VariantId = (typeof VARIANTS)[number]["id"];

export function ContextHealthSwitcher({ slug, rows }: ContextVariantProps) {
  const [variant, setVariant] = useState<VariantId>("baseline");
  const active = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-divider bg-surface/40 px-4 py-2.5">
        <Kicker tone="muted">Prototype</Kicker>
        <div className="flex flex-wrap items-center gap-1.5">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              aria-current={v.id === variant ? "true" : undefined}
              title={v.note}
              className={`focus-ring rounded-full border px-3 py-1 font-mono text-sm transition ${
                v.id === variant
                  ? "border-accent/60 text-accent"
                  : "border-slate-700 text-slate-400 hover:border-accent hover:text-white"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs uppercase tracking-[0.22em] text-slate-600">
          {active.note}
        </span>
      </div>
      {variant === "half-life" && <ContextHalfLife slug={slug} rows={rows} />}
    </div>
  );
}
