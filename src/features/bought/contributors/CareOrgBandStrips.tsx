// "How sessions look here" — the quartile strip that used to be a sentence over a table.
//
// The header said: "Quartiles across everyone sharing. A developer comparing themselves sees these
// bands and no names." That is `Distribution`'s specification written as a paragraph. Drawn, the
// privacy half needs no promise at all — there is no name in a box plot, and there is no prop here
// that could put one there. Only the SHAPE of the shared data (p25 · median · p75, nothing else)
// still has to be said, because a box whose ends are quartiles rather than extremes is a box a
// reader would otherwise misread. That sentence rides in the WhyChip.
//
// Extracted from CareOrgAggregate.tsx to keep both files under the 200-LOC cap. Server-safe.

import { SectionEmpty } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import { Distribution, WhyChip } from "@/components/org/viz";
import {
  CARE_SHAPE_LABEL,
  CARE_SHAPE_ORDER,
  CARE_SHAPE_PCT,
  careShapeValue,
  type CareOrgView,
} from "@/lib/org/developer-view";

const BAND_HINT =
  "Developers share three points, not a full distribution: the strip runs p25 → p75 and the marked " +
  "line is the median. Its ends are quartiles, not the smallest and largest values.";

export function CareOrgBands({ org }: { org: CareOrgView }) {
  const fields = CARE_SHAPE_ORDER.filter((f) => org.shapeBands[f]);
  if (fields.length === 0) {
    return <SectionEmpty>No shape distribution yet — nobody has shared these counts.</SectionEmpty>;
  }

  return (
    <div className="mt-3">
      <div className="flex justify-end">
        <WhyChip hint={BAND_HINT} label="what the strip spans" align="end" />
      </div>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {fields.map((f) => {
          const band = org.shapeBands[f]!;
          const unit = CARE_SHAPE_PCT.has(f) ? "%" : "";
          return (
            <div key={f}>
              <div className="flex items-baseline justify-between gap-3">
                <Kicker tone="muted">{CARE_SHAPE_LABEL[f]}</Kicker>
                <span className="font-mono type-mono-sm tabular-nums text-white">{careShapeValue(f, band.p50)}</span>
              </div>
              {/* p25 and p75 stand in for the whiskers because they are the only points shared — the
                  strip is honest about its own ends via the WhyChip above, and inventing a tail
                  would be exactly the kind of confident wrongness this redesign is removing. */}
              <Distribution
                className="mt-1"
                min={band.p25}
                q1={band.p25}
                median={band.p50}
                q3={band.p75}
                max={band.p75}
                label={`${CARE_SHAPE_LABEL[f]} — org quartiles, p25 to p75`}
                unit={unit}
                digits={0}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
