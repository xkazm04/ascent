// EnablementTargets — the actionable half of the "none" bucket: the zero-AI contributors carrying the
// most recent volume, i.e. where enablement moves the org's AI share fastest. Names individuals, so it
// is OPT-IN (default collapsed) with the same "inputs, not a to-do list" framing as the Contributors
// tab's individual drill-down — never a passive scoreboard. Server-safe (native <details>).

import { OrgTable } from "@/components/org/ui";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { timeAgo } from "@/lib/ui";

export function EnablementTargets({ targets, nonePool }: { targets: AdoptionOverview["enablement"]; nonePool: number }) {
  return (
    <details id="enablement" className="rounded-xl border border-slate-800 bg-slate-900/20">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-slate-200 marker:text-slate-600">
        <span>
          Who to enable next <span className="font-mono text-sm text-slate-500">({targets.length})</span>
        </span>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">names individuals — expand</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <p className="max-w-2xl text-sm text-slate-400">
          Contributors with the most recent commit volume and <span className="text-slate-300">no AI-attributed commits yet</span> — the
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
            {nonePool} contributors show no AI-attributed commits in total — these {targets.length} carry the most recent volume.
          </p>
        )}
      </div>
    </details>
  );
}
