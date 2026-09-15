// "Enforce in CI" card — the gate API + GitHub Action snippet that enforces the identical policy in
// pipelines. Extracted from the old governance page.tsx JSX (docs/ORG-TABS-REFACTOR.md JSX-region
// split).
//
// Org UX redesign §2: "the dashboard gate and your pipeline run the identical policy: no drift" is a
// STATUS, not a standfirst — and it was only half true. The two marks below say which half is which:
// the server policy is `measured` (enforced, live), the parameters you paste are `declared` (a
// snapshot the gate treats as a tighten-only overlay). Both sentences ride along as the marks' hints.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Legend, StateSwatch } from "@/components/org/viz";
import { CopyForLlm } from "@/components/CopyForLlm";

const CI_MARKS = [
  {
    id: "server",
    label: "Server policy · enforced",
    swatch: <StateSwatch state="measured" />,
    hint: "The dashboard gate and your pipeline call the identical server policy, so raising the org bar reaches every pasted workflow immediately: no drift in that direction.",
  },
  {
    id: "snapshot",
    label: "Pasted parameters · snapshot",
    swatch: <StateSwatch state="declared" />,
    hint: "The parameters below are today's policy written down. The gate treats them as a tighten-only overlay, so LOWERING the org bar does not reach a workflow that already pasted the stricter number.",
  },
];

export function GovernanceCiCard({ gateQuery, snippet }: { gateQuery: string; snippet: string }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader size="sm" title="Enforce in CI" />
        <CopyForLlm text={snippet} label="Copy CI snippet" />
      </div>
      {/* §2.2 — the two marks, not a sentence, are the first thing under the header. */}
      <Legend className="mt-3" extra={CI_MARKS} />
      <div className="mt-3 space-y-3">
        <div>
          <div className="font-mono type-micro uppercase tracking-widest text-slate-500">Gate API</div>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono type-micro text-slate-300">
            GET &lt;ASCENT_URL&gt;/api/gate/&lt;owner&gt;/&lt;repo&gt;?{gateQuery}
            {"\n"}<span className="text-slate-500"># 200 = pass · 422 = fail (curl --fail exits non-zero)</span>
          </pre>
        </div>
        <div>
          <div className="font-mono type-micro uppercase tracking-widest text-slate-500">GitHub Action</div>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono type-micro text-slate-300">{snippet}</pre>
        </div>
        {/* UAT `PRIYA-L1-06`. "Edit once, both change" holds in one direction only, and the
            asymmetry is deliberate: the params are a TIGHTEN-ONLY overlay, so an anonymous caller
            cannot loosen the server's bar. The reasoning was right and the disclosure was missing —
            a lead who later relaxes the org policy would otherwise find pasted workflows still
            enforcing the old, stricter one with nothing on this card having said so. */}
        {/* The asymmetry itself is now the `declared` mark and its hint above; what stays in text is
            the ACTION, which no encoding can carry. */}
        <p className="type-body-sm text-slate-500">
          Re-copy the snippet after you relax the org bar, or drop the parameters and let the workflow follow the
          server policy alone.
        </p>
      </div>
    </Card>
  );
}
