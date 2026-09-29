// v2 dimension section: three SDLC phases, nine spectral lines. Replaces the Altimeter phase strip + ledger
// grid: the phase head carries the phase average, each line carries its own reading, the tick is the green
// floor. The owed count is a scope readout (a number, not a claim), as in the Altimeter ledger.
import { Eyebrow, Frame, SectionHead } from "@/components/kit";
import { groupByPhase, type DimensionReading } from "./dimensionReading";
import { DimensionLedgerRow } from "./DimensionLedgerRow.v2";
import { GREEN_FLOOR, owedCount } from "./phaseStanding";

export function DimensionLedger({ slug, readings, search }: { slug: string; readings: DimensionReading[]; search: string }) {
  const owed = owedCount(readings);
  // When NO dimension has a movement baseline (a thin window), say so once instead of nine void marks.
  const noBaseline = readings.length > 0 && readings.every((r) => r.delta === null);
  return (
    <Frame id="dimensions">
      <SectionHead
        eyebrow="Dimensions · fleet average"
        title="Three phases,"
        named="nine lines."
        lede={`${owed.n} of ${owed.of} below green ${GREEN_FLOOR}. The tick on each line is the green floor; the line is the fleet average.${noBaseline ? " There is no movement baseline in this window, so no line shows a change." : ""}`}
      />
      {groupByPhase(readings).map((g) => (
        <section key={g.phase.id} className="mt-8" aria-label={g.phase.label}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <Eyebrow>{g.phase.label}</Eyebrow>
              <p className="mt-1 type-body-sm text-slate-400">{g.phase.question}</p>
            </div>
            {g.avg !== null && <span className="font-mono type-mono-sm tabular-nums text-slate-400">phase avg {g.avg}</span>}
          </div>
          {g.rows.map((r) => (
            <DimensionLedgerRow key={r.dimId} r={r} slug={slug} search={search} baselineNoted={noBaseline} />
          ))}
        </section>
      ))}
    </Frame>
  );
}
