"use client";

// PROTOTYPE SCAFFOLD, consolidated — Debt Ledger won the "AI-era debt" round; Fault Lines and
// Leverage Map are deleted. Baseline STAYS the default (and renders the untouched BacklogPanel)
// because the ledger's quality metrics are still mock (debtMockData.ts) — it only becomes the
// render once the real delivery-quality signal lands. The Backlog tab is a SERVER component (it
// awaits getOrgBacklog), so the variant state lives in this client wrapper.

import { useMemo, useState } from "react";
import type { OrgBacklog } from "@/lib/db";
import { BacklogPanel } from "@/components/org/plan/backlog/BacklogPanel";
import { buildDebtFleet } from "./debtModel";
import { DebtLedger } from "./DebtLedger";

type VariantId = "baseline" | "ledger";

const TABS: { id: VariantId; label: string; hint: string }[] = [
  { id: "baseline", label: "Baseline", hint: "Today's recommendation backlog" },
  { id: "ledger", label: "Debt Ledger", hint: "Statement of account — how much, and at what interest" },
];

export function DebtSwitcher({
  slug,
  initial,
  segmentId = null,
  techGroupId = null,
}: {
  slug: string;
  initial: OrgBacklog;
  segmentId?: string | null;
  techGroupId?: string | null;
}) {
  const [variant, setVariant] = useState<VariantId>("baseline");
  const fleet = useMemo(() => buildDebtFleet(initial), [initial]);
  const active = TABS.find((t) => t.id === variant)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-surface/40 p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setVariant(t.id)}
            aria-pressed={variant === t.id}
            className={`focus-ring rounded-lg px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] transition-colors ${
              variant === t.id ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto pr-1 text-xs text-slate-500">{active.hint}</span>
      </div>

      {variant === "baseline" && (
        <BacklogPanel slug={slug} initial={initial} segmentId={segmentId} techGroupId={techGroupId} />
      )}
      {variant === "ledger" && <DebtLedger slug={slug} fleet={fleet} />}
    </div>
  );
}
