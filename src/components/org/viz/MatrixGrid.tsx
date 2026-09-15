"use client";

// A declared × observed × enforced heat matrix — /prototype round 1.
//
// The renderer that shipped is `MatrixGridBaseline`; this file is the throwaway tab switcher that
// lets the two directional variants (Ledger, Strata) be A/B'd against it in place. The exported
// `MatrixGrid` keeps its props contract, so none of the ~20 consumers change. The choice is held in
// one module-level store rather than per instance: a dashboard tab renders several matrices, and
// judging a direction means seeing all of them flip at once.

import { useSyncExternalStore } from "react";
import { MatrixGridBaseline } from "@/components/org/viz/MatrixGridBaseline";
import { MatrixGridLedger } from "@/components/org/viz/MatrixGridLedger";
import { MatrixGridStrata } from "@/components/org/viz/MatrixGridStrata";
import type { MatrixGridProps } from "@/components/org/viz/matrixShared";

export type { MatrixCell, MatrixRow } from "@/components/org/viz/matrixShared";

type Variant = "baseline" | "ledger" | "strata";

const VARIANTS: { id: Variant; label: string; Render: (p: MatrixGridProps) => React.JSX.Element }[] = [
  { id: "baseline", label: "Baseline", Render: MatrixGridBaseline },
  { id: "ledger", label: "Ledger", Render: MatrixGridLedger },
  { id: "strata", label: "Strata", Render: MatrixGridStrata },
];

// --- the shared store: one choice for every matrix on the page ----------------------------------
let current: Variant = "baseline";
const listeners = new Set<() => void>();
function setVariant(v: Variant) {
  current = v;
  for (const l of listeners) l();
}
function useVariant(): Variant {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => "baseline",
  );
}

export function MatrixGrid(props: MatrixGridProps) {
  const variant = useVariant();
  const active = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0]!;
  return (
    <div className={props.className}>
      <div className="mb-2 flex flex-wrap items-center gap-1" data-proto-switcher>
        <span className="type-micro mr-1 font-mono uppercase tracking-[0.18em] text-slate-600">proto</span>
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={v.id === variant}
            onClick={() => setVariant(v.id)}
            className={`focus-ring type-micro rounded-md border px-2 py-0.5 font-mono uppercase tracking-[0.12em] transition ${
              v.id === variant ? "border-accent/60 bg-surface/40 text-accent" : "border-divider text-slate-500 hover:text-slate-300"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <active.Render {...props} className="" />
    </div>
  );
}
