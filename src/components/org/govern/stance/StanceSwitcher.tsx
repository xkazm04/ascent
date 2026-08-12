"use client";

// PROTOTYPE SCAFFOLD, consolidated — Perimeter won the AI-stance round; Charter and Ledger are
// deleted. Baseline STAYS the default tab because Perimeter still renders the mock stance doc
// (stanceMock.ts) — it only becomes the render once a real stance model lands. The Governance tab's
// panel is an async SERVER component, so the already-fetched governance overview is turned into the
// mock stance server-side and handed down as props; this client wrapper only holds the selection.

import { useState } from "react";
import type { AiStanceDoc } from "./stanceMock";
import { StancePerimeter } from "./StancePerimeter";

type Variant = "baseline" | "perimeter";

const TABS: { id: Variant; label: string; hint: string }[] = [
  { id: "baseline", label: "Baseline", hint: "The shipped gate view" },
  { id: "perimeter", label: "Perimeter", hint: "The stance as a fleet boundary map" },
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
      {variant === "perimeter" ? <StancePerimeter doc={doc} slug={slug} /> : null}
    </div>
  );
}
