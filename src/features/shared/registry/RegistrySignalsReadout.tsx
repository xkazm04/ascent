// The `signals/` lane, per subject (#18): how often the corpus was reached for, how often someone
// had to depart from it, and whether its own citations still resolve.
//
// This is the feedback the corpus needs about itself and cannot get anywhere else — a subject nobody
// consults is a retirement candidate, a subject everybody deviates from is a rewrite candidate.
//
// EVERY NUMBER HERE CAN BE GENUINELY UNMEASURED, and a null renders "—". `contributors: 0` renders
// "no witness" and never a green tick: nobody reporting is not the same as nothing to report, and a
// tick would be a claim about the corpus made out of silence.
//
// Server-safe (no hooks).

import { Kicker } from "@/components/ui";
import { OrgTable } from "@/components/org/shared/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { readCount, signalRows } from "./conformanceModel";

/** Rows drawn before the table stops being a readout and becomes a data dump. */
const MAX_ROWS = 20;

export function RegistrySignalsReadout({ view }: { view: RegistryView }) {
  const contributors = view.signals?.contributors ?? 0;
  const rows = signalRows(view);

  if (contributors === 0 || rows.length === 0) {
    return (
      <div className="space-y-2">
        <Kicker tone="muted">Corpus signals</Kicker>
        <p className="type-body-sm text-slate-500">
          <span className="font-mono text-slate-400">no witness</span> — nothing has been contributed to the
          registry&rsquo;s <code className="font-mono">signals/</code> lane, so how often your subjects are
          consulted, deviated from, or found stale is unknown. Unknown, not zero.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Corpus signals</Kicker>
        <span className="type-caption text-slate-500">
          {contributors} contributor{contributors === 1 ? "" : "s"} · {rows.length} subject
          {rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <OrgTable
        minWidth={560}
        caption="Per subject: consults, deviations and citation health as contributors reported them"
        head={
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-normal">
              subject
            </th>
            <th scope="col" className="px-4 py-2 text-right font-normal">
              consults
            </th>
            <th scope="col" className="px-4 py-2 text-right font-normal">
              deviations
            </th>
            <th scope="col" className="px-4 py-2 text-right font-normal" title="resolved / moved / gone">
              citations
            </th>
            <th scope="col" className="px-4 py-2 text-right font-normal">
              witnesses
            </th>
          </tr>
        }
      >
        {rows.slice(0, MAX_ROWS).map((s) => (
          <tr key={`${s.bundle}/${s.subjectSlug}`}>
            <td className="px-4 py-2 type-mono-sm text-slate-300" title={s.bundle}>
              {s.subjectSlug}
            </td>
            <td className="px-4 py-2 text-right type-mono-sm tabular-nums text-slate-200">{readCount(s.consults)}</td>
            <td className="px-4 py-2 text-right type-mono-sm tabular-nums text-slate-200">{readCount(s.deviations)}</td>
            <td className="px-4 py-2 text-right type-mono-sm tabular-nums text-slate-400">
              {readCount(s.citResolved)}/{readCount(s.citMoved)}/{readCount(s.citGone)}
            </td>
            <td className="px-4 py-2 text-right type-mono-sm tabular-nums text-slate-500">{s.contributors}</td>
          </tr>
        ))}
      </OrgTable>

      <p className="type-note text-slate-600">
        Counts only, summed across contributors. A &ldquo;—&rdquo; means that contributor never measured it,
        which is not the same as measuring zero.
        {rows.length > MAX_ROWS ? ` Showing ${MAX_ROWS} of ${rows.length} subjects.` : ""}
      </p>
    </div>
  );
}
