// Shared presentational atoms for the AI delivery views (Table + Map): the verdict pill and the
// "noCostSource spend" honesty badge. Pure render (no hooks) so either view can use them. Verdict colors
// come from the model's VERDICT_META (single source of truth).

import { VERDICT_META, type Verdict } from "./aiDeliveryModel";

export function VerdictChip({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  const m = VERDICT_META[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs ${className}`}
      style={{ borderColor: `${m.hex}66`, backgroundColor: `${m.hex}1a`, color: m.hex }}
      title={m.blurb}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.hex }} />
      {m.label}
    </span>
  );
}

const FIDELITY_UI: Record<string, { label: string; hex: string; title: string }> = {
  measured: { label: "measured spend", hex: "#22c55e", title: "Spend attributed to the exact repo by the provider (Claude Code telemetry). Adoption & governance are always real (git)." },
  allocated: { label: "allocated spend", hex: "#f59e0b", title: "Provider reports above repo level; Ascent distributes it to repos by AI-attributed PR volume. Adoption & governance are real (git)." },
  noCostSource: { label: "noCostSource spend", hex: "#64748b", title: "No provider connected — deterministic placeholder. Connect one under Govern → Integrations. Adoption & governance are real (git)." },
};

/** Badges where the spend numbers came from (model.fidelity): measured / allocated / noCostSource. */
export function FidelityBadge({ fidelity, className = "" }: { fidelity: string; className?: string }) {
  const m = FIDELITY_UI[fidelity] ?? FIDELITY_UI.noCostSource!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-widest ${className}`}
      style={{ borderColor: `${m.hex}66`, backgroundColor: `${m.hex}1a`, color: m.hex }}
      title={m.title}
    >
      {m.label}
    </span>
  );
}
