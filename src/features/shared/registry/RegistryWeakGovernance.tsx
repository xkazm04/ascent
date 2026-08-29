// Weak governance (#18): where the corpus has nothing confident to say about how a repo works.
//
// This is the registry's OWN backlog, and it is authored by evidence rather than by opinion — each
// repo's `.ai/registry-map.json` decides, per context, whether any subject matched it strongly
// enough to govern it. A high share here is not a failing repo; it is a gap in the written corpus.
//
// STATED LIMITATION, in the UI and not only in a comment: the ingest can persist how MANY of a
// repo's contexts are weakly governed, not which ones — `RepoConformanceMap` has a count column and
// no names column. So this ranks repos, and the per-context list is named as the missing half rather
// than implied by an empty table.
//
// Server-safe (no hooks).

import { Kicker } from "@/components/ui";
import { OrgTable } from "@/components/org/shared/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { weakGovernance } from "./conformanceModel";

export function RegistryWeakGovernance({ view }: { view: RegistryView }) {
  const rows = weakGovernance(view);

  if (!view.conformance) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Weakly governed</Kicker>
        <span className="font-mono text-xs text-slate-500">
          where the corpus has nothing confident to say
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          Every context in every mapped repo matched a governing subject with confidence. That is a
          statement about the CORPUS&rsquo;s coverage, not about the code.
        </p>
      ) : (
        <OrgTable
          minWidth={480}
          caption="Repositories ranked by the share of their contexts no subject governs confidently"
          head={
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-normal">
                repo
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                weak
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                contexts
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                share
              </th>
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.repoFullName}>
              <td className="px-4 py-2 font-mono text-sm text-slate-300">{r.repoFullName}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-slate-200">{r.weak}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-slate-500">{r.contexts}</td>
              <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-slate-400">{r.share}%</td>
            </tr>
          ))}
        </OrgTable>
      )}

      <p className="text-xs text-slate-600">
        Counted from each repo&rsquo;s own map. Which contexts they are is not stored yet — the ingest
        keeps the count, so this ranks repos rather than listing contexts.
      </p>
    </div>
  );
}
