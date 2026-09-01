// The reading strip — four typeset readouts over the selected dimension's detail, in one hairline
// ledger: its level, the next rung, the overall points in reach, and the two witnesses (how far the
// model's judgment sat from the detectors, or why its number was not used). Pure presentational.

import { scoreHex } from "@/lib/ui";
import type { DimFacts } from "@/components/report/dimensionExplorerDerive";
import { provenanceLabel } from "@/components/report/dimensionExplorerDerive";
import { HairlineGrid, Stat, signedDelta } from "@/components/ui";

export function DimensionReading({ f }: { f: DimFacts }) {
  const blended = f.provenance.kind === "blended";
  return (
    <HairlineGrid className="grid-cols-2 md:grid-cols-4">
      <Stat
        className="bg-ink p-4"
        label="Level"
        value={f.level.id}
        raw
        color={scoreHex(f.d.score)}
        sub={f.level.name}
        delta={f.delta}
        deltaLabel={f.delta !== null ? "since last scan" : undefined}
      />
      <Stat
        className="bg-ink p-4"
        label="Next rung"
        value={f.next ? `+${f.toNext}` : "summit"}
        sub={f.next ? `to ${f.next.id} ${f.next.name}` : "top band held"}
      />
      <Stat
        className="bg-ink p-4"
        label="In reach"
        value={`+${f.headroom.toFixed(1)}`}
        sub={`overall pts · weight ${Math.round(f.d.weight * 100)}%`}
      />
      <Stat
        className="bg-ink p-4"
        label="Model vs detectors"
        value={blended ? signedDelta(f.divergence) : "—"}
        sub={blended ? `model ${f.d.llmScore} · detectors ${f.d.signalScore}` : provenanceLabel(f.provenance)}
      />
    </HairlineGrid>
  );
}
