// Shared presentational atoms for the AI delivery views (Table + Map): the verdict pill and the
// spend-provenance honesty badge. Pure render (no hooks) so either view can use them. Verdict colors
// come from the model's VERDICT_META (single source of truth).
//
// THE BADGE USED TO RENDER ITS OWN KEY. `FIDELITY_UI` was a `Record<string, …>` keyed on
// `noCostSource`, a member `ModelFidelity` has never had — the model passes `none` — so every lookup
// missed, fell through the `?? FIDELITY_UI.noCostSource!` guard, and printed the literal identifier
// "noCostSource spend" to the customer, under a title still promising a "deterministic placeholder"
// that W3c retired. Keying the table on `ModelFidelity` makes the map total: a lookup cannot miss,
// so the fallback (and its non-null assertion) is gone and a new tier is a compile error here.

import { VERDICT_META, type ModelFidelity, type Verdict } from "./aiDeliveryModel";

export function VerdictChip({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  const m = VERDICT_META[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 type-caption ${className}`}
      style={{ borderColor: `${m.hex}66`, backgroundColor: `${m.hex}1a`, color: m.hex }}
      title={m.blurb}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.hex }} />
      {m.label}
    </span>
  );
}

const FIDELITY_UI: Record<ModelFidelity, { label: string; hex: string; title: string }> = {
  measured: { label: "measured spend", hex: "#22c55e", title: "Spend attributed to the exact repo by the provider (Claude Code telemetry). Adoption & governance are always real (git)." },
  allocated: { label: "allocated spend", hex: "#f59e0b", title: "Provider reports above repo level; Ascent distributes it to repos by AI-attributed PR volume. Adoption & governance are real (git)." },
  // Absence, not simulation: the spend layer is simply not there. Nothing is estimated and no figure
  // is synthesized, so the money columns read empty rather than as a placeholder dollar amount.
  none: { label: "No cost source", hex: "#64748b", title: "No provider reports cost, so there is no spend layer: the money columns are empty rather than estimated. Connect one under Govern → Integrations. Adoption & governance are real (git)." },
};

/** Badges where the spend numbers came from (model.fidelity): measured / allocated / none. Typed to
 *  `ModelFidelity`, so the lookup is total and there is nothing to fall back to. */
export function FidelityBadge({ fidelity, className = "" }: { fidelity: ModelFidelity; className?: string }) {
  const m = FIDELITY_UI[fidelity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 type-label tracking-widest ${className}`}
      style={{ borderColor: `${m.hex}66`, backgroundColor: `${m.hex}1a`, color: m.hex }}
      title={m.title}
    >
      {m.label}
    </span>
  );
}
