// Direction A — **Ledger**. The bundle as an accounting record.
//
// Metaphor: a stock ledger. One row per domain, columns that line up, numbers that add to a
// footer total. It reads as the sibling of `RegistryArtifactLedger` because it IS one — the same
// TILE_LEDGER bed, the same mono kickers, the same tabular numerals — so the Knowledge base tab
// feels like the fourth artifact rather than a new product bolted onto the Shared group.
//
// Why this direction: the question "how much knowledge do we have, and where is it concentrated"
// is a counting question, and counting questions are answered by columns that align. Ties are
// broken by name in `sortDomains` so the row order never shuffles between loads.
//
// What it deliberately does NOT do: no drill-down, no per-subject list, no graph. A row is terminal.

import { Kicker, Stat } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { artifactTotal, type KnowledgeDomain, type KnowledgeView } from "@/lib/org/knowledge-view";

/** The three layers that publish, in hierarchy order — the column contract for every row. */
const LAYERS = [
  { key: "subjects", label: "Golden paths" },
  { key: "techniques", label: "Techniques" },
  { key: "applications", label: "Applications" },
] as const;

function DomainRow({ domain }: { domain: KnowledgeDomain }) {
  const total = artifactTotal(domain);
  const { written, total: techniques } = domain.useWhenCoverage;
  const consultPct = techniques === 0 ? 0 : Math.round((written / techniques) * 100);

  return (
    <div className="bg-ink px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-medium text-slate-100">{domain.title}</h3>
        <span className="font-mono text-xs text-slate-600">knowledge/{domain.name}/</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-4">
        {LAYERS.map((layer) => (
          <Stat key={layer.key} label={layer.label} value={domain[layer.key]} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-divider pt-3">
        <span className="font-mono text-xs text-slate-500">
          <span className="tabular-nums text-slate-300">{total.toLocaleString()}</span> artifacts ·{" "}
          <span className="tabular-nums text-slate-300">{domain.categories.length}</span> categories ·{" "}
          <span className="tabular-nums text-slate-300">{domain.laws}</span> laws cited
        </span>
        {/* Consult-readiness earns a colour because it is a genuine 0-100 completion, the same
            reason the migration ramp is coloured in RegistryArtifactLedger. */}
        <span className="font-mono text-xs uppercase tracking-[0.16em]" style={{ color: scoreHex(consultPct) }}>
          consult-ready {written}/{techniques}
        </span>
      </div>
    </div>
  );
}

export function KnowledgeLedger({ view }: { view: KnowledgeView }) {
  const { totals } = view;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Kicker tone="muted">Published across every bundle</Kicker>
        <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
          <div className="bg-ink px-5 py-4">
            <Stat label="Domains" value={totals.domains} />
          </div>
          <div className="bg-ink px-5 py-4">
            <Stat label="Golden paths" value={totals.subjects} />
          </div>
          <div className="bg-ink px-5 py-4">
            <Stat label="Techniques" value={totals.techniques} />
          </div>
          <div className="bg-ink px-5 py-4">
            <Stat label="Applications" value={totals.applications} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Kicker tone="muted">Bundles, heaviest first</Kicker>
        <div className={`${TILE_LEDGER} sm:grid-cols-2`}>
          {view.domains.map((d) => (
            <DomainRow key={d.name} domain={d} />
          ))}
        </div>
        <p className="font-mono text-xs text-slate-500">
          Evidence is not counted here — it stays in each consuming repo, so a number in this column
          would always read zero and mean the wrong thing.
        </p>
      </div>
    </div>
  );
}
