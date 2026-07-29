// Concentration / bus factor — how spread out each repo's commits are; high top-share or bus-factor 1
// flags key-person risk. A key-person repo is a DECISION, not just a warning chip: accept the risk,
// dismiss it with a reason, or snooze — and it leaves the org rail's Contributors badge either way.
// Extracted out of the old page.tsx body (docs/ORG-TABS-REFACTOR.md) into its own named file.

import { OrgTable, SectionHeader } from "@/components/org/shared/ui";
import { DecisionControl } from "@/components/org/DecisionControl";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { ContributorInsights } from "@/lib/db";
import { AiBar } from "./AiBar";

export function ContributorsConcentrationTable({
  slug,
  rows,
  decisions,
}: {
  slug: string;
  rows: ContributorInsights["concentration"];
  decisions: DecisionMap;
}) {
  return (
    <div id="concentration" className="mt-8 scroll-mt-24">
      <SectionHeader
        title="Concentration & bus factor"
        description={
          <>
            How spread out each repo&apos;s commits are.{" "}
            <span className="text-orange-400">High top-share or bus-factor 1 = key-person risk.</span>
          </>
        }
      />
      <OrgTable
        className="mt-3"
        caption="Commit concentration and bus factor by repository"
        head={
          <tr>
            <th className="px-4 py-2 text-left">Repo</th>
            <th className="px-3 py-2 text-right">Contributors</th>
            <th className="px-3 py-2 text-left">Top contributor</th>
            <th className="px-3 py-2 text-left">Top share</th>
            <th className="px-3 py-2 text-right">Bus factor</th>
            <th className="px-3 py-2 text-left">Decision</th>
          </tr>
        }
      >
        {rows.map((r) => (
          <tr key={r.fullName} className="text-slate-300">
            <td className="px-4 py-2">
              <span className="font-mono text-sm text-white">{r.name}</span>
              {r.soloMaintainer && (
                <span className="ml-2 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-orange-300">
                  key-person
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{r.contributorCount}</td>
            <td className="px-3 py-2 font-mono text-sm text-slate-400">{r.topLogin}</td>
            <td className="px-3 py-2">
              <AiBar pct={r.topShare} color={r.topShare >= 80 ? "var(--color-warn)" : undefined} />
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: r.busFactor <= 1 ? "var(--color-warn)" : undefined }}>
              {r.busFactor}
            </td>
            <td className="px-3 py-2">
              {/* Only solo-maintained repos are findings — the rest have nothing to decide. */}
              {r.soloMaintainer ? (
                <DecisionControl
                  org={slug}
                  module="contributors"
                  itemKey={r.fullName}
                  title={`${r.fullName} is solo-maintained`}
                  status={decisions[r.fullName]?.status ?? "open"}
                  rationale={decisions[r.fullName]?.rationale}
                  decidedBy={decisions[r.fullName]?.decidedBy}
                />
              ) : (
                <span className="text-slate-600">—</span>
              )}
            </td>
          </tr>
        ))}
      </OrgTable>
    </div>
  );
}
