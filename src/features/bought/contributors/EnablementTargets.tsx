// EnablementTargets — the actionable half of the "none" bucket: the zero-AI contributors carrying the
// most recent volume, i.e. where enablement moves the org's AI share fastest. Names individuals, so it
// is OPT-IN (default collapsed) with the same "inputs, not a to-do list" framing as the Contributors
// tab's individual drill-down — never a passive scoreboard.
//
// Moved out of the Adoption tab (2026-08-19) into the Contributors group, where it belongs: it is a
// named per-person roster, which is the one thing this tab is FOR. Adoption's spread bar points here
// by cross-tab deep link (`?tab=contributors#enablement`), hence `scroll-mt-24`.
//
// The cohort itself is `enablementTargets` (src/lib/org/adoption.ts) — ONE definition, shared with
// the adoption LLM brief, carrying the CHAMPION_MIN_POP naming guard. An empty list is the render
// guard; no call site re-checks the population.
//
// The paragraph that used to explain the recency filter is now the picture: `BudgetPack` draws the
// zero-AI pool as the budget, this list as what was packed into it, and the remainder as an OMISSION
// block whose label carries the horizon. "Says what it left out" stopped being a promise.

import { OrgTable } from "@/components/org/shared/ui";
import { BudgetPack, WhyChip } from "@/components/org/viz";
import { ENABLEMENT_MAX_IDLE_DAYS, type AdoptionOverview } from "@/lib/org/adoption";
import { timeAgo } from "@/lib/ui";

/** The A3 framing, on demand. The list itself must never read as a shortfall report. */
const INVITE_HINT =
  "The highest-leverage people to offer tooling, pairing or agent guidance to. Inputs to explore, not a " +
  "to-do list for anyone.";

export function EnablementTargets({
  targets,
  nonePool,
}: {
  targets: AdoptionOverview["enablement"];
  /** Everyone with zero AI-attributed commits, so the graphic can show what it left out. */
  nonePool: number;
}) {
  const omitted = Math.max(0, nonePool - targets.length);
  return (
    <details id="enablement" className="scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/20">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-slate-200 marker:text-slate-600">
        <span>
          Who to enable next <span className="type-mono-sm text-slate-500">({targets.length})</span>
        </span>
        <span className="type-mono-sm uppercase tracking-widest text-slate-500">names individuals, expand to see</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <BudgetPack
            className="max-w-sm flex-1"
            label="Zero-AI contributors invited"
            used={targets.length}
            budget={nonePool}
            omissions={
              omitted > 0
                ? [
                    {
                      id: "outside",
                      // The horizon is part of the claim: an invitation list that quietly reached back
                      // further would head itself with someone who left months ago.
                      label: `not listed · idle past ${ENABLEMENT_MAX_IDLE_DAYS} days, thin volume, or past the cap`,
                      count: omitted,
                      state: "measured" as const,
                    },
                  ]
                : []
            }
          />
          <WhyChip hint={INVITE_HINT} label="what this list is for" align="end" />
        </div>
        <OrgTable
          className="mt-4"
          minWidth={520}
          caption={`Highest-volume contributors without AI-attributed commits, active within ${ENABLEMENT_MAX_IDLE_DAYS} days of the latest observed activity`}
          head={
            <tr>
              <th className="px-4 py-2 text-left">Contributor</th>
              <th className="px-3 py-2 text-right">Commits</th>
              <th className="px-3 py-2 text-right">Repos</th>
              <th className="px-3 py-2 text-left">Last active</th>
            </tr>
          }
        >
          {targets.map((t) => (
            <tr key={t.login} className="text-slate-300">
              <td className="px-4 py-2">
                <span className="type-mono-sm text-white">{t.login}</span>
                {t.name && <span className="ml-2 type-body-sm text-slate-500">{t.name}</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{t.commits}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{t.repos}</td>
              <td className="px-3 py-2 type-body-sm text-slate-500">{timeAgo(t.lastActiveAt ?? undefined)}</td>
            </tr>
          ))}
        </OrgTable>
      </div>
    </details>
  );
}
