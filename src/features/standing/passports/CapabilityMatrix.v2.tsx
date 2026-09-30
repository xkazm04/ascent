// Prism capabilities. The three-axis grid stays (no kit matrix). The ledger is a DataTable.
// A fleet with nothing declared shows a void, never 0%. No meter painted from a score hue.
import { Legend, MatrixGrid } from "@/components/org/viz";
import { DataTable, Frame, Lede, SectionHead, StatStrip, StatTile } from "@/components/kit";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { buildCapabilityMatrix, verifiedRatio, type CapabilityMatrixInput } from "./capabilityAgg";
import { CapabilityLegendV2 } from "./CapabilityLegend.v2";
import { CapabilityRowV2 } from "./CapabilityRow.v2";
import { CAPABILITY_AXES, capabilityVizRows, capabilityVizStates } from "./capabilityViz";

export function CapabilityMatrixV2({ repos, rollout = [] }: { repos: CapabilityMatrixInput[]; rollout?: FoundationRolloutRow[] }) {
  const matrix = buildCapabilityMatrix(repos);
  const ratio = verifiedRatio(matrix);
  const vizRows = capabilityVizRows(matrix);
  const rolloutByRepo = new Map(rollout.map((r) => [r.repo.toLowerCase(), r]));
  const assessed = matrix.rows.length;

  return (
    <div className="space-y-10">
      <Frame aria-label="Capabilities">
        <SectionHead
          eyebrow="Declared versus proven"
          title="Capabilities"
          named={assessed === 1 ? "1 assessed." : `${assessed} assessed.`}
          lede={`${matrix.unassessed.length} not assessed.`}
        />
        {assessed > 0 && (
          <div className="mt-6">
            <MatrixGrid
              axes={[...CAPABILITY_AXES]}
              rows={vizRows}
              title={`Capabilities across ${assessed} assessed ${assessed === 1 ? "repository" : "repositories"}`}
            />
            <Legend states={capabilityVizStates(vizRows)} className="mt-3" />
          </div>
        )}
      </Frame>

      <StatStrip cols={3}>
        <StatTile label="Repos assessed" value={matrix.totals.repos} sub={`${matrix.unassessed.length} not assessed`} />
        <StatTile
          label="Capabilities proven"
          value={ratio === null ? <span className="text-[0.9375rem] font-normal text-slate-400">not measured</span> : `${matrix.totals.verified}/${matrix.totals.declared}`}
          sub={ratio === null ? "no manifest read yet" : `${ratio}% of what the fleet declares`}
        />
        <StatTile label="Declarations with a control" value={matrix.totals.wired} sub="pre-push or CI hard pass" />
      </StatStrip>

      <Frame edge="both" aria-label="Repositories by declared capability">
        <SectionHead id="capability-table-heading" eyebrow="Repositories" title="Declared capability" named="by repository." />
        <div className="mt-5">
          {assessed === 0 ? (
            <Lede>
              No repository in this view has had its <code className="text-slate-200">.ai/manifest.yaml</code> read yet. Re-scan a repository that
              carries one and it appears here: nothing is inferred in the meantime.
            </Lede>
          ) : (
            <DataTable
              density="compact"
              stickyHead="page"
              stickyFirstCol
              minWidth={720 + matrix.capabilities.length * 128}
              caption="Repositories by declared capability"
              labelledBy="capability-table-heading"
              head={
                <tr>
                  <th className="px-3 py-2 text-left">Repository</th>
                  {matrix.capabilities.map((c) => (
                    <th key={c} className="px-3 py-2 text-center">{c}</th>
                  ))}
                  <th className="px-3 py-2 text-right">Proven</th>
                  <th className="px-3 py-2 text-left">Report-back</th>
                  <th className="px-3 py-2 text-left">Declared</th>
                </tr>
              }
            >
              {matrix.rows.map((row) => (
                <CapabilityRowV2 key={row.fullName} row={row} capabilities={matrix.capabilities} rollout={rolloutByRepo.get(row.fullName.toLowerCase())} />
              ))}
            </DataTable>
          )}
        </div>
      </Frame>

      <CapabilityLegendV2 />

      {matrix.unassessed.length > 0 && (
        <Frame aria-label="Not assessed">
          <SectionHead eyebrow="Not assessed, re-scan" title="Outside" named="every ratio." />
          <Lede className="mt-3">
            These repositories are counted in no ratio above. Their latest scan did not read a manifest, so the honest
            statement is that we do not know what they declare: not that they declare nothing.
          </Lede>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.9375rem] text-slate-300">
            {matrix.unassessed.map((u) => (
              <li key={u.fullName}>
                {u.fullName}
                <span className="ml-1.5 text-slate-400">({u.reason === "unreadable" ? "manifest unreadable" : "no manifest in this scan"})</span>
              </li>
            ))}
          </ul>
        </Frame>
      )}
    </div>
  );
}
