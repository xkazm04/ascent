"use client";

// PROTOTYPE SCAFFOLD (throwaway) — the A/B tab strip for the AI-stance directional variants.
// The Governance tab's panel is an async SERVER component, so the already-fetched governance
// overview is turned into the mock stance server-side and handed down as props; this client wrapper
// only holds the `variant` selection. Baseline is the default tab, so the tab loads visually
// unchanged. Delete this file (and the whole `stance/` folder's non-winners) at consolidation.

import { useState } from "react";
import type { AiStanceDoc } from "./stanceMock";
import { StanceCharter } from "./StanceCharter";
import { StancePerimeter } from "./StancePerimeter";
import { StanceLedger } from "./StanceLedger";

type Variant = "baseline" | "charter" | "perimeter" | "ledger";

const TABS: { id: Variant; label: string; hint: string }[] = [
  { id: "baseline", label: "Baseline", hint: "The shipped gate view" },
  { id: "charter", label: "A · Charter", hint: "The stance as a published document" },
  { id: "perimeter", label: "B · Perimeter", hint: "The stance as a fleet boundary map" },
  { id: "ledger", label: "C · Ledger", hint: "The stance as a versioned contract + compliance ledger" },
];

export function StanceSwitcher({
  baseline,
  stance,
  unpublished,
  slug,
}: {
  baseline: React.ReactNode;
  stance: AiStanceDoc;
  /** The same doc with `published: false` — drives each variant's "publish your stance" CTA state. */
  unpublished: AiStanceDoc;
  slug: string;
}) {
  const [variant, setVariant] = useState<Variant>("baseline");
  const [empty, setEmpty] = useState(false);
  const doc = empty ? unpublished : stance;
  const active = TABS.find((t) => t.id === variant)!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-divider bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setVariant(t.id)}
              aria-current={variant === t.id ? "true" : undefined}
              className={`focus-ring rounded-md px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] transition ${
                variant === t.id ? "bg-accent/10 text-accent" : "text-slate-500 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-slate-500 sm:inline">{active.hint}</span>
          {variant !== "baseline" && (
            <label className="flex cursor-pointer items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
              <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} className="accent-accent" />
              No stance yet
            </label>
          )}
        </div>
      </div>

      {variant === "baseline" ? baseline : null}
      {variant === "charter" ? <StanceCharter doc={doc} slug={slug} /> : null}
      {variant === "perimeter" ? <StancePerimeter doc={doc} slug={slug} /> : null}
      {variant === "ledger" ? <StanceLedger doc={doc} slug={slug} /> : null}
    </div>
  );
}
