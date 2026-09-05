// "Enforce in CI" card — the gate API + GitHub Action snippet that enforces the identical policy in
// pipelines. Extracted from the old governance page.tsx JSX (docs/ORG-TABS-REFACTOR.md JSX-region
// split).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { CopyForLlm } from "@/components/CopyForLlm";

export function GovernanceCiCard({ gateQuery, snippet }: { gateQuery: string; snippet: string }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader size="sm" title="Enforce in CI" description="The dashboard gate and your pipeline run the identical policy: no drift." />
        <CopyForLlm text={snippet} label="Copy CI snippet" />
      </div>
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
        <p className="type-body-sm text-slate-500">
          These parameters are a <strong className="text-slate-400">snapshot</strong> of today&apos;s policy. The gate
          treats them as a tighten-only overlay, so <em>raising</em> the org bar reaches every pasted workflow
          immediately — while <em>lowering</em> it does not, because the pasted params keep enforcing the stricter
          number. Re-copy the snippet after you relax the bar, or drop the parameters and let the workflow follow the
          server policy alone.
        </p>
      </div>
    </Card>
  );
}
