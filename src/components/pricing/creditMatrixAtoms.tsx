// Shared, server-safe atoms for the credit-matrix variants: the credit-tag chip, a per-plan cell
// renderer (✓ / — / value), and the plan column head. Kept hookless so either a server or a client
// variant can import them. One azure accent + the slate ramp only (BRAND: color is earned) — the
// accent marks "included / the paid mechanic"; free/plan tags differ by glyph + weight, not new hues.

import { CREDIT_TAG_META, type CreditTag, type Cell, type MatrixPlan } from "./creditMatrixData";

/** Tone classes per credit tag. `credit` earns the accent; `free`/`plan` stay on the slate ramp. */
const TAG_TONE: Record<CreditTag, string> = {
  credit: "border-accent/40 bg-accent/10 text-accent",
  free: "border-slate-600 bg-slate-800/40 text-slate-200",
  plan: "border-slate-700 bg-transparent text-slate-400",
};

export function CreditTagChip({ tag, className = "" }: { tag: CreditTag; className?: string }) {
  const m = CREDIT_TAG_META[tag];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs uppercase tracking-widest ${TAG_TONE[tag]} ${className}`}
      title={m.label}
    >
      <span aria-hidden>{m.glyph}</span>
      {m.short}
    </span>
  );
}

/** A per-plan cell: ✓ (accent) / — (muted, sr-only "not included") / a mono value. */
export function CellMark({ value, className = "" }: { value: Cell; className?: string }) {
  if (typeof value === "string") {
    return <span className={`font-mono text-sm tabular-nums text-slate-200 ${className}`}>{value}</span>;
  }
  if (value) {
    return (
      <span className={`text-accent ${className}`} aria-hidden>
        ✓<span className="sr-only">Included</span>
      </span>
    );
  }
  return (
    <span className={`text-slate-700 ${className}`}>
      <span aria-hidden>—</span>
      <span className="sr-only">Not included</span>
    </span>
  );
}

/** A plan column head: label + its monthly-scan allowance sub-line. Featured tier reads in accent. */
export function PlanHead({ plan, align = "center" }: { plan: MatrixPlan; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "text-center" : "text-left"}>
      <div className={`text-sm font-semibold ${plan.featured ? "text-accent" : "text-white"}`}>{plan.label}</div>
      <div className="mt-0.5 font-mono text-xs uppercase tracking-widest text-slate-500">
        {plan.allowance === "∞" ? "Unlimited" : `${plan.allowance} / mo`}
      </div>
    </div>
  );
}
