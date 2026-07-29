// "Where the fleet fails" card — per-condition breakdown. Extracted from the old governance
// page.tsx JSX (docs/ORG-TABS-REFACTOR.md JSX-region split).

import { Card, InlineEmpty, Meter, SectionHeader } from "@/components/org/shared/ui";
import { GOVERNANCE_FAIL_REASONS } from "./governanceReasons";
import type { GovernanceOverview } from "@/lib/org/governance";

export function GovernanceFailReasonsCard({ g }: { g: GovernanceOverview }) {
  return (
    <Card>
      <SectionHeader size="sm" title="Where the fleet fails" description="Repos failing each gate condition (counted once per repo)." />
      {g.failing === 0 ? (
        <InlineEmpty>Every scanned repo clears the gate.</InlineEmpty>
      ) : (
        <div className="mt-3 space-y-2">
          {GOVERNANCE_FAIL_REASONS.map((r) => {
            const n = g.byReason[r.key];
            const pct = g.scanned ? Math.round((n / g.scanned) * 100) : 0;
            return (
              <div key={r.key} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 text-slate-400">{r.label}</span>
                <Meter className="flex-1" value={pct} color={n ? "#ef4444" : "#334155"} />
                <span className="w-16 shrink-0 text-right font-mono text-slate-300">{n} repo{n === 1 ? "" : "s"}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
