// "Enforce in CI" card — the gate API + GitHub Action snippet that enforces the identical policy in
// pipelines. Extracted from the old governance page.tsx JSX (docs/ORG-TABS-REFACTOR.md JSX-region
// split).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { CopyForLlm } from "@/components/CopyForLlm";

export function GovernanceCiCard({ gateQuery, snippet }: { gateQuery: string; snippet: string }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader size="sm" title="Enforce in CI" description="The dashboard gate and your pipeline run the identical policy — no drift." />
        <CopyForLlm text={snippet} label="Copy CI snippet" />
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Gate API</div>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-300">
            GET &lt;ASCENT_URL&gt;/api/gate/&lt;owner&gt;/&lt;repo&gt;?{gateQuery}
            {"\n"}<span className="text-slate-500"># 200 = pass · 422 = fail (curl --fail exits non-zero)</span>
          </pre>
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-slate-500">GitHub Action</div>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-300">{snippet}</pre>
        </div>
      </div>
    </Card>
  );
}
