// Kit batch 3 specimen (2026-09-30): the DataTable options, the hue-versus-meaning treatments and the Trend
// part. Synthetic data only; nothing here is a measurement.
import { CELL, DataTable, DimensionLine, HEAD_CELL, Masthead, Trend } from "@/components/kit";

function Row({ name, note, children }: { name: string; note: string; children: React.ReactNode }) {
  return (
    <div data-specimen={`b3-${name}`} className="grid gap-4 border-t border-divider py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <p className="font-mono type-mono-sm text-slate-300">{name}</p>
        <p className="type-note text-slate-500">{note}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

const RUNS = [
  { repo: "sample-api", cells: [true, true, false, true] },
  { repo: "sample-web", cells: [false, true, true, false] },
];

export function KitBatch3() {
  return (
    <section aria-label="Kit batch 3" className="mt-12">
      <p className="type-label tracking-[0.22em] text-slate-500">Batch 3 · options and rulings</p>
      <Row name="DataTable options" note="compact density, a foot, a sticky first column; sheet = a grid of runs whose left rules show only where a run starts.">
        <DataTable
          caption="Compact table with a foot"
          minWidth={420}
          density="compact"
          stickyFirstCol
          head={<tr><th className={HEAD_CELL}>Repo</th><th className={`${HEAD_CELL} text-right`}>D1</th><th className={`${HEAD_CELL} text-right`}>D2</th></tr>}
          foot={<tr><th scope="row" className={`${CELL} text-left font-normal`}>Fleet average</th><td className={`${CELL} text-right tabular-nums`}>71</td><td className={`${CELL} text-right tabular-nums`}>64</td></tr>}
        >
          <tr><th scope="row" className={`${CELL} text-left font-normal`}>sample-api</th><td className={`${CELL} text-right tabular-nums`}>80</td><td className={`${CELL} text-right tabular-nums`}>66</td></tr>
          <tr><th scope="row" className={`${CELL} text-left font-normal`}>sample-web</th><td className={`${CELL} text-right tabular-nums`}>62</td><td className={`${CELL} text-right tabular-nums`}>62</td></tr>
        </DataTable>
        <DataTable caption="Sheet variant" minWidth={420} variant="sheet" head={<tr><th className={HEAD_CELL}>Gap</th>{[1, 2, 3, 4].map((n) => <th key={n} data-run-start className={`${HEAD_CELL} border-l border-divider`}>Run {n}</th>)}</tr>}>
          {RUNS.map((r) => (
            <tr key={r.repo}>
              <th scope="row" className={`${CELL} text-left font-normal`}>{r.repo}</th>
              {r.cells.map((on, i) => (
                <td key={i} data-run-start={on ? "" : undefined} className={`${CELL} border-l border-divider`}>{on ? "closed" : ""}</td>
              ))}
            </tr>
          ))}
        </DataTable>
      </Row>
      <Row name="DimensionLine shortfall" note="Below the floor, the gap to the floor is a hatched span in the dimension's own hue (Prism). A healthy bar at 85% or more is desaturated a step.">
        <DimensionLine dimension={3} label="CI & Delivery" value={0.42} floor={0.65} display="42" />
        <DimensionLine dimension={5} label="Guardrails" value={0.9} floor={0.65} display="90" />
      </Row>
      <Row name="Masthead tone" note="Status travels by glyph and word, never by hue: healthy, watch, at risk. The value stays paper.">
        <Masthead
          statement="Synthetic org"
          named="in three tones"
          figures={[
            { label: "Adoption", value: 86, tone: "good" },
            { label: "Rigor", value: 52, tone: "watch" },
            { label: "Coverage", value: 31, tone: "risk" },
          ]}
        />
      </Row>
      <Row name="Trend" note="240x56 against the level bands the series touches (padded one band). Fewer points than the forecast minimum say so in words.">
        <Trend values={[48, 52, 51, 58, 63, 67, 71]} label="last 90 days" />
        <Trend values={[48, 52]} label="last 90 days" />
      </Row>
    </section>
  );
}
