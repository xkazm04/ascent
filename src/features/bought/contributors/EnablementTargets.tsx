// EnablementTargets — the actionable half of the "none" bucket: the zero-AI contributors carrying the
// most recent volume, i.e. where enablement moves the org's AI share fastest. Names individuals, so it
// is OPT-IN (default collapsed) with the same "inputs, not a to-do list" framing as the Contributors
// tab's individual drill-down — never a passive scoreboard. Server-safe (native <details>).
//
// Moved out of the Adoption tab (2026-08-19) into the Contributors group, where it belongs: it is a
// named per-person roster, which is the one thing this tab is FOR and the thing Adoption otherwise
// keeps at arm's length (rates, bands, teams). It now sits directly under IndividualInvolvement, so
// the two per-person lists — who is leaning in, who hasn't started — read as one section. Adoption's
// spread bar still points here by cross-tab deep link (`?tab=contributors#enablement`), hence
// `scroll-mt-24` so the arriving anchor clears the sticky header.
//
// The cohort itself is `enablementTargets` (src/lib/org/adoption.ts) — ONE definition, shared with
// the adoption LLM brief, carrying the CHAMPION_MIN_POP naming guard. An empty list is the render
// guard; no call site re-checks the population.

import { OrgTable } from "@/components/org/shared/ui";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { timeAgo } from "@/lib/ui";

export function EnablementTargets({
  targets,
  nonePool,
}: {
  targets: AdoptionOverview["enablement"];
  /** Everyone with zero AI-attributed commits, so the table can say what it left out. */
  nonePool: number;
}) {
  return (
    <details id="enablement" className="scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/20">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-slate-200 marker:text-slate-600">
        <span>
          Who to enable next <span className="font-mono text-sm text-slate-500">({targets.length})</span>
        </span>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">names individuals, expand to see</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <p className="max-w-2xl text-sm text-slate-400">
          Contributors with the most recent commit volume and <span className="text-slate-300">no AI-attributed commits yet</span>: the
          highest-leverage people to offer tooling, pairing, or agent guidance to. Inputs to explore,{" "}
          <span className="text-slate-300">not a to-do list for anyone</span>.
        </p>
        <OrgTable
          className="mt-3"
          minWidth={520}
          caption="Highest-volume contributors without AI-attributed commits"
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
                <span className="font-mono text-sm text-white">{t.login}</span>
                {t.name && <span className="ml-2 text-sm text-slate-500">{t.name}</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{t.commits}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{t.repos}</td>
              <td className="px-3 py-2 text-sm text-slate-500">{timeAgo(t.lastActiveAt ?? undefined)}</td>
            </tr>
          ))}
        </OrgTable>
        {nonePool > targets.length && (
          <p className="mt-2 font-mono text-sm text-slate-600">
            {nonePool} contributors show no AI-attributed commits in total; these {targets.length} carry the most recent volume.
          </p>
        )}
      </div>
    </details>
  );
}
