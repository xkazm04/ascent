// Per-individual involvement — the Contributors tab's opt-in drill-down. Co-located extraction from
// page.tsx (300-LOC rule); behavior unchanged apart from the population-floor branch. Server-safe.

import { ExportCsvLink, OrgTable } from "@/components/org/shared/ui";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import { Kicker } from "@/components/ui";
import { StateSwatch, WhyChip } from "@/components/org/viz";
import type { ContributorInsights } from "@/lib/db";
import { timeAgo } from "@/lib/ui";
import { AiBar } from "./AiBar";
import { isViewer, YouMark } from "./ContributorsYouPointer";

/** The A3 framing that used to sit permanently above the roster, demoted to an on-demand chip. */
const USE_HINT =
  "For capability and coverage planning — who could seed agent guidance, where key-person risk sits — " +
  "and never performance evaluation.";

// Per-individual involvement — OPT-IN, default collapsed. The default contributor view is team-level
// (the tiles, champions-when-population-allows, and Concentration / bus-factor below); naming individuals
// is a deliberate drill-down for capability/coverage planning, never a passive performance scoreboard.
// The per-person CSV lives here too, behind the same deliberate opt-in.
export function IndividualInvolvement({
  insights,
  slug,
  segmentId,
  stack,
  viewerLogin = null,
}: {
  insights: ContributorInsights;
  slug: string;
  segmentId: string | null;
  /** Active tech-stack group key — forwarded so the CSV matches the filtered view. */
  stack: string | null;
  /** §5.2 — the viewer's login, so their own row points at their Developer view. */
  viewerLogin?: string | null;
}) {
  // Withheld, not missing: getContributorInsights returns NO per-person rows below the floor (and the
  // CSV route 403s on the same condition), so say why rather than rendering an empty table.
  if (!insights.namingAllowed) {
    return (
      <div id="individuals" className="mt-8 scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/20 px-4 py-4">
        {/* The void mark leads: this is a WITHHOLDING, and §2.4's encoding says so before the copy
            does — nothing is drawn where the rows would be. */}
        <div className="flex items-center gap-2">
          <StateSwatch state="missing" />
          <span className="font-medium text-slate-200">Individual involvement</span>
        </div>
        <p className="mt-2 max-w-2xl type-body-sm text-slate-400">
          Withheld: with fewer than {CHAMPION_MIN_POP} contributors, a per-person table (and its CSV) names
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
          Individual involvement <span className="type-mono-sm text-slate-500">({insights.contributors.length})</span>
        </span>
        <span className="type-mono-sm uppercase tracking-widest text-slate-500">names individuals, expand</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <Kicker tone="muted" as="span">
              breadth × depth · AI-commit share
            </Kicker>
            <WhyChip hint={USE_HINT} label="what this roster is for" />
          </span>
          <ExportCsvLink org={slug} kind="contributors" segmentId={segmentId} stack={stack} className="shrink-0" />
        </div>
        <OrgTable
          className="mt-3"
          minWidth={720}
          caption="Contributors by involvement: repos, commits, and AI-commit share"
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
                <span className="type-mono-sm text-white">{c.login}</span>
                {c.name && <span className="ml-2 type-body-sm text-slate-500">{c.name}</span>}
                {isViewer(c.login, viewerLogin) && (
                  <span className="ml-2 inline-block align-middle">
                    <YouMark slug={slug} />
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{c.commits}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-accent">{c.aiCommits}</td>
              {/* No commits in the window means there was nothing to take a share OF: a void, not a
                  measured 0% (§2.4). The two used to render as the same empty bar. */}
              <td className="px-3 py-2"><AiBar pct={c.commits > 0 ? c.aiShare : null} label={`${c.login} AI share`} /></td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="type-mono-sm text-slate-400">{c.repos}</span>
                  {c.repoNames.slice(0, 3).map((r) => (
                    <span key={r} className="rounded border border-slate-700 px-1.5 py-0.5 type-mono-sm text-slate-400">
                      {r.split("/")[1] ?? r}
                    </span>
                  ))}
                  {c.repos > 3 && <span className="type-mono-sm text-slate-600">+{c.repos - 3}</span>}
                </div>
              </td>
              <td className="px-3 py-2 type-body-sm text-slate-500">{timeAgo(c.lastActiveAt ?? undefined)}</td>
            </tr>
          ))}
        </OrgTable>
        {insights.contributors.length > 50 && (
          <p className="mt-2 type-mono-sm text-slate-600">Showing top 50 of {insights.contributors.length} by commits.</p>
        )}
      </div>
    </details>
  );
}
