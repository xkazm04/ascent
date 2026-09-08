// Per-dimension standing and movement — the chart is the panel; this file is its frame.
//
// The header used to carry the digest's copy of *"Where each dimension stands now, and how it moved
// over the week. An em dash is a missing measurement, not a zero."* — the last live instance of a
// sentence Delivery encoded away in Wave 1. `DigestDimChart` draws all three of its readings, and
// the two that are genuinely epistemic (the noise band; the void) ride the legend as hover text.
//
// NOTE, and it is deliberate: the pasted markdown (`digest-markdown.ts`) still prints "—" and
// "flat (within noise)" IN WORDS. A recipient reading the update in Slack has no band to look at and
// no legend to hover, so there the words ARE the encoding. The screen and the artifact diverge here
// on purpose; §2 governs the screen.

import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Legend } from "@/components/org/viz";
import type { WeeklyDigest } from "@/lib/org/digest-types";
import { DigestDimChart } from "./DigestDimChart";
import { NOISE, deltaExtent, dimBars, presentStates } from "./digestViz";

const NOISE_HINT =
  `A move of ${NOISE} points or less is inside the scan-to-scan noise band: two independent re-scans of the ` +
  `same commit moved ±1, so a bar that stays in the shaded band is a hold, not a climb.`;

/** The band at legend scale — the real mark, painted the way the chart paints it (Legend's rule 1). */
function NoiseSwatch() {
  return (
    <svg viewBox="0 0 14 14" width={14} height={14} className="shrink-0" role="presentation" aria-hidden>
      <rect x={0} y={1.5} width={14} height={11} fill="var(--color-divider)" fillOpacity={0.35} />
      <line x1={7} y1={1.5} x2={7} y2={12.5} stroke="var(--color-divider)" strokeWidth={1} />
    </svg>
  );
}

export function DigestDimensions({ dims }: { dims: WeeklyDigest["dims"] }) {
  const bars = dimBars(dims);
  const noneMeasured = bars.every((b) => b.delta == null);

  return (
    <Card>
      <SectionHeader size="sm" title="Score deltas per dimension" />
      {bars.length === 0 ? (
        <InlineEmpty>No dimensions were scored across the fleet this week.</InlineEmpty>
      ) : (
        <>
          <div className="mt-3">
            <DigestDimChart bars={bars} extent={deltaExtent(bars.map((b) => b.delta))} />
          </div>
          {noneMeasured && (
            // The (O) state for the whole panel: every row is a void, and the reader is owed the
            // reason rather than a lane of dashes.
            <InlineEmpty>
              No repository was scanned on both sides of this week, so no dimension has a move to report.
            </InlineEmpty>
          )}
          <Legend
            className="mt-3"
            states={presentStates(bars.map((b) => b.state))}
            extra={[{ id: "noise", label: `noise band ±${NOISE}`, swatch: <NoiseSwatch />, hint: NOISE_HINT }]}
          />
        </>
      )}
    </Card>
  );
}
