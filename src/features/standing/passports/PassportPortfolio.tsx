"use client";

// Baseline: one hairline frame for the quadrant chart and the docket, one for the table.
// The cohort filter is a shared hook.
import { Frame, GhostAction, SectionHead } from "@/components/kit";
import type { DecisionMap } from "@/lib/org/decision-map";
import { COHORT_META } from "@/lib/org/passport-display";
import { PassportBlockers } from "./PassportBlockers";
import { PassportScatter } from "./PassportScatter";
import type { PassportRow } from "./PassportTable";
import { PassportTableView } from "./PassportTableView";
import { usePassportCohort } from "./usePassportCohort";

export function PassportPortfolio({ rows, org, decisions }: { rows: PassportRow[]; org: string; decisions: DecisionMap }) {
  const { filter, setFilter, focus, visible, points, toggle, scopeLabel, onPoint } = usePassportCohort(rows);
  return (
    <div className="space-y-10">
      <Frame aria-label="Automation by production">
        <SectionHead
          eyebrow="Portfolio"
          title="Automation beside"
          named="production."
          lede="Click a quadrant to isolate that cohort. Click a point to open its row."
          actions={
            filter ? (
              <GhostAction onClick={() => setFilter(null)} aria-label="Reset to all passports">
                ✕ {COHORT_META[filter].label}
              </GhostAction>
            ) : undefined
          }
        />
        <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
          <PassportScatter points={points} active={filter} onCohort={toggle} onPoint={onPoint} marks="paper" />
          <PassportBlockers rows={visible} scopeLabel={scopeLabel} org={org} decisions={decisions} />
        </div>
      </Frame>
      <Frame edge="both" pad="md" aria-label="Passport table">
        <SectionHead id="passport-table-heading" eyebrow="Repositories" title="Every passport" named="in this cohort." />
        <div className="mt-5">
          {visible.length === 0 ? (
            <p className="type-body text-slate-300">
              No repos in the {scopeLabel} cohort for the current scope. Click the highlighted quadrant again (or the ✕ above) to clear it.
            </p>
          ) : (
            <PassportTableView rows={visible} focus={focus} org={org} decisions={decisions} />
          )}
        </div>
      </Frame>
    </div>
  );
}
