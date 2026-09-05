"use client";

// The Knowledge base tab's prototype switcher — REACT STATE, never a search param (same rule as
// `RegistryPreviewShell`): a shaped fleet must never become a shareable URL that reads as this org's.
//
// Offered ONLY in development (`registryPreviewEnabled()` at the KnowledgeTab call site). Baseline is
// the real, server-rendered tab (passed as `children`); the three directions render the shaped
// `fixtureKnowledgeView` and are stamped as previews. THROWAWAY: the switcher collapses to the
// winner when the prototype round ends.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { KnowledgeAtlas } from "./KnowledgeAtlas";
import { KnowledgeBoard } from "./KnowledgeBoard";
import { KnowledgeLoom } from "./KnowledgeLoom";

const VARIANTS = [
  { id: "baseline", label: "Baseline", hint: "the ledger as shipped" },
  { id: "atlas", label: "Atlas", hint: "tree first — the registry's own folders, annotated with the fleet" },
  { id: "loom", label: "Loom", hint: "matrix first — every subject × every mapped repo, pick cells into a brief" },
  { id: "board", label: "Board", hint: "stage first — repos as cards in the registry's pipeline, dispatch per repo" },
] as const;

type VariantId = (typeof VARIANTS)[number]["id"];

const CHIP = "focus-ring rounded-md px-2.5 py-1.5 type-mono-sm transition-colors";

export function KnowledgeSwitcher({ fixture, children }: { fixture: KnowledgeView; children: React.ReactNode }) {
  const [variant, setVariant] = useState<VariantId>("baseline");
  const active = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-divider bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Kicker tone="muted">Prototype · dev only</Kicker>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Knowledge base direction">
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={v.id === variant}
                className={`${CHIP} ${v.id === variant ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-white"}`}
                onClick={() => setVariant(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <span className="type-caption text-slate-500">{active.hint}</span>
        </div>
        {variant !== "baseline" ? (
          <p className="mt-2 type-caption text-slate-600">
            Preview — a shaped fleet over the registry&rsquo;s real software-engineering taxonomy (52 of 214 subjects). Nothing here is this org&rsquo;s data.
          </p>
        ) : null}
      </div>
      {variant === "baseline" ? children : null}
      {variant === "atlas" ? <KnowledgeAtlas view={fixture} /> : null}
      {variant === "loom" ? <KnowledgeLoom view={fixture} /> : null}
      {variant === "board" ? <KnowledgeBoard view={fixture} /> : null}
    </div>
  );
}
