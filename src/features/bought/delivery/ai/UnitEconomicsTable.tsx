// The per-repository unit-economics ledger. Extracted from UnitEconomics.tsx for the 200-LOC cap,
// and kept as a TABLE deliberately: this is row-level auditable evidence — the one shape the /org
// redesign explicitly preserves (§2.7) — and it now sits BELOW a graphic that gives the fleet reading
// rather than being the first thing the panel offers.
//
// Server-safe — no hooks, no handlers.

import { OrgTable } from "@/components/org/shared/ui";
import { STATE_HINT } from "@/components/org/viz";
import type { UnitEconomicsView } from "@/lib/db/unit-economics";

/** Cents → "$1.23" / "$1,234". Whole dollars above $100, where cents are noise. */
export function usd(cents: number): string {
  const d = cents / 100;
  return d >= 100 ? `$${Math.round(d).toLocaleString()}` : `$${d.toFixed(2)}`;
}

/**
 * A nullable figure with the reason it is absent — never a fabricated zero. It carries the kit's own
 * `missing` sentence alongside the cell-specific reason, so the dash here means exactly what the void
 * in the ribbon above means.
 */
function Absent({ reason }: { reason: string }) {
  return (
    <span data-state="missing" className="font-mono tabular-nums text-slate-500" title={`${reason}. ${STATE_HINT.missing}`}>
      —
    </span>
  );
}

export function UnitEconomicsTable({ view }: { view: UnitEconomicsView }) {
  return (
    <OrgTable
      caption="Per-repository unit economics"
      minWidth={720}
      head={
        <tr className="text-left">
          <th className="px-4 py-3">Repository</th>
          <th className="px-4 py-3 text-right">Sessions</th>
          <th className="px-4 py-3 text-right">Produced code</th>
          <th className="px-4 py-3 text-right">Spend</th>
          <th className="px-4 py-3 text-right">Per producing session</th>
          <th className="px-4 py-3 text-right">Per merged AI change</th>
        </tr>
      }
    >
      {view.rows.map((r) => (
        <tr key={r.repoFullName}>
          <td className="px-4 py-3 text-white">{r.repoFullName}</td>
          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{r.sessions}</td>
          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">
            {r.producedRate == null ? <Absent reason="No sessions" /> : `${r.producedRate}%`}
          </td>
          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{usd(r.costCents)}</td>
          <td className="px-4 py-3 text-right">
            {r.costPerProducingSession == null ? (
              <Absent reason="No session in this repo produced a commit or PR" />
            ) : (
              <span className="font-mono tabular-nums text-white">{usd(r.costPerProducingSession)}</span>
            )}
          </td>
          <td className="px-4 py-3 text-right">
            {r.costPerMergedAiChange == null ? (
              <Absent reason="No AI-attributed change merged in this repo during the period: no denominator, which is not the same as free" />
            ) : (
              <span className="font-mono tabular-nums text-white" title={`over ${r.mergedAiChanges} merged AI changes`}>
                {usd(r.costPerMergedAiChange)}
              </span>
            )}
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}
