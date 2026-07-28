// Per-individual involvement — the Contributors tab's opt-in drill-down. Co-located extraction from
// page.tsx (300-LOC rule); behavior unchanged apart from the population-floor branch. Server-safe.

import { ExportCsvLink, OrgTable } from "@/components/org/shared/ui";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import type { ContributorInsights } from "@/lib/db";
import { timeAgo } from "@/lib/ui";
import { AiBar } from "./AiBar";

// Per-individual involvement — OPT-IN, default collapsed. The default contributor view is team-level
// (the tiles, champions-when-population-allows, and Concentration / bus-factor below); naming individuals
// is a deliberate drill-down for capability/coverage planning, never a passive performance scoreboard.
// The per-person CSV lives here too, behind the same deliberate opt-in.
export function IndividualInvolvement({
  insights,
  slug,
  segmentId,
  stack,
}: {
  insights: ContributorInsights;
  slug: string;
  segmentId: string | null;
  /** Active tech-stack group key — forwarded so the CSV matches the filtered view. */
  stack: string | null;
}) {
  // Withheld, not missing: getContributorInsights returns NO per-person rows below the floor (and the
  // CSV route 403s on the same condition), so say why rather than rendering an empty table.
  if (!insights.namingAllowed) {
    return (
      <div id="individuals" className="mt-8 scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/20 px-4 py-4">
        <div className="font-medium text-slate-200">Individual involvement</div>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Withheld — with fewer than {CHAMPION_MIN_POP} contributors, a per-person table (and its CSV) names
          one or two identifiable people rather than describing a team. The totals, AI share and
          concentration figures above and below cover the same activity in aggregate.
        </p>
      </div>
    );
  }

  return (
    <details id="individuals" className="mt-8 scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/20">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-slate-200 marker:text-slate-600">
        <span>
          Individual involvement <span className="font-mono text-sm text-slate-500">({insights.contributors.length})</span>
        </span>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">names individuals — expand</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-slate-400">
            For capability and coverage planning — who could seed agent guidance, where key-person risk sits —{" "}
            <span className="text-slate-300">not performance evaluation</span>. Breadth (repos) × depth (commits) and each
            person&apos;s AI-commit share.
          </p>
          <ExportCsvLink org={slug} kind="contributors" segmentId={segmentId} stack={stack} className="shrink-0" />
        </div>
        <OrgTable
          className="mt-3"
          minWidth={720}
          caption="Contributors by involvement — repos, commits, and AI-commit share"
          head={
            <tr>
              <th className="px-4 py-2 text-left">Contributor</th>
              <th className="px-3 py-2 text-right">Commits</th>
              <th className="px-3 py-2 text-right">AI</th>
              <th className="px-3 py-2 text-left">AI share</th>
              <th className="px-3 py-2 text-left">Repos</th>
              <th className="px-3 py-2 text-left">Last active</th>
            </tr>
          }
        >
          {insights.contributors.slice(0, 50).map((c) => (
            <tr key={c.login} className="text-slate-300">
              <td className="px-4 py-2">
                <span className="font-mono text-sm text-white">{c.login}</span>
                {c.name && <span className="ml-2 text-sm text-slate-500">{c.name}</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{c.commits}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-accent">{c.aiCommits}</td>
              <td className="px-3 py-2"><AiBar pct={c.aiShare} /></td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-mono text-sm text-slate-400">{c.repos}</span>
                  {c.repoNames.slice(0, 3).map((r) => (
                    <span key={r} className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
                      {r.split("/")[1] ?? r}
                    </span>
                  ))}
                  {c.repos > 3 && <span className="font-mono text-sm text-slate-600">+{c.repos - 3}</span>}
                </div>
              </td>
              <td className="px-3 py-2 text-sm text-slate-500">{timeAgo(c.lastActiveAt ?? undefined)}</td>
            </tr>
          ))}
        </OrgTable>
        {insights.contributors.length > 50 && (
          <p className="mt-2 font-mono text-sm text-slate-600">Showing top 50 of {insights.contributors.length} by commits.</p>
        )}
      </div>
    </details>
  );
}
