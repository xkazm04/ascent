// The subject × repo conformance grid (#18): which of our OWN written standards each repo knowingly
// departs from, with the repo's own `file:line` evidence in the cell's title.
//
// NOT A SCORE, and so deliberately not on the score ramp: no `LEVEL_HEX`, no `scoreHex`. A deviation
// is a decision someone recorded, not a failure to reach a number, and colouring it red-to-green
// would turn a governance ledger into a leaderboard. The cells are hairline swatches on the ledger's
// own bed — the accent at full weight for a deviation, a rule for conformant, hollow for
// not-applicable, an em dash for unjudged.
//
// Server-safe (no hooks).

import { Kicker, Surface } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { buildMatrix, conformanceReading, STATE_GLYPH, STATE_LABEL, type CellState } from "./conformanceModel";

const CELL_CLASS: Record<CellState, string> = {
  deviation: "bg-accent/25 text-accent",
  conformant: "bg-surface/60 text-slate-400",
  "not-applicable": "bg-ink text-slate-700",
  unjudged: "bg-ink text-slate-600",
  absent: "bg-ink text-slate-800",
};

/** How many subjects the grid draws. Beyond this it stops being readable as a grid. */
const MAX_ROWS = 24;

export function RegistryConformanceMap({ view }: { view: RegistryView }) {
  const reading = conformanceReading(view);
  const c = view.conformance;

  if (!reading || !c) {
    return (
      <div className="space-y-2">
        <Kicker tone="muted">Conformance</Kicker>
        <p className="type-body-sm text-slate-500">
          No sweep has run yet, so nothing is known about how the fleet tracks against your own corpus —
          which is not the same as a fleet that conforms. Run a conformance sweep from the registry
          actions to read each repo&rsquo;s <code className="font-mono">.ai/registry-map.json</code>.
        </p>
      </div>
    );
  }

  const matrix = buildMatrix(c.pairs, c.repos);
  const rows = matrix.subjects.slice(0, MAX_ROWS);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Conformance · subject × repo</Kicker>
        <span className="type-caption text-slate-500">{reading.headline}</span>
      </div>

      {matrix.empty ? (
        <p className="type-body-sm text-slate-500">
          Every pair is still <span className="font-mono">unjudged</span>. The maps are ingested; nobody has
          evaluated a context against its governing subject yet, so there is no verdict to show — an
          honest &ldquo;—&rdquo;, not a clean bill.
        </p>
      ) : (
        <Surface radius="xl" className="overflow-x-auto p-0">
          <table className="w-full border-collapse type-body-sm" style={{ minWidth: `${240 + matrix.repos.length * 92}px` }}>
            <caption className="sr-only">Conformance of each repository against each governing subject</caption>
            <thead>
              <tr className="type-label tracking-[0.16em] text-slate-500">
                <th scope="col" className="px-4 py-2 text-left font-normal">
                  subject
                </th>
                {matrix.repos.map((repo) => (
                  <th key={repo} scope="col" className="px-2 py-2 text-left font-normal" title={repo}>
                    {repo.split("/").pop()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={TILE_LEDGER}>
              {rows.map((s) => (
                <tr key={s.slug}>
                  <th scope="row" className="bg-ink px-4 py-1.5 text-left font-normal text-slate-300">
                    <span className="type-mono-sm">{s.slug}</span>
                    <span className="ml-2 type-caption text-slate-600">{s.deviations || ""}</span>
                  </th>
                  {matrix.repos.map((repo) => {
                    const cell = matrix.cell(s.slug, repo);
                    const title = `${repo} · ${s.slug} — ${STATE_LABEL[cell.state]}${
                      cell.evidence ? `: ${cell.evidence}` : ""
                    }`;
                    return (
                      <td key={repo} className={`px-2 py-1.5 text-center type-mono-sm ${CELL_CLASS[cell.state]}`} title={title}>
                        {STATE_GLYPH[cell.state]}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}

      <p className="type-caption text-slate-600">
        ▮ deviation · • conformant · ◦ not applicable · — unjudged
        {matrix.subjects.length > MAX_ROWS ? ` · showing ${MAX_ROWS} of ${matrix.subjects.length} subjects` : ""}
        {c.truncated ? " · pair list truncated" : ""}
      </p>
    </div>
  );
}
