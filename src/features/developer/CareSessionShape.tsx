// The session-shape strip: the 30-day counts the developer CHOSE to share, each plotted against the
// anonymous org band.
//
// The header used to carry the whole reading as a sentence — "Only the counts you chose to share.
// The org band, when shown, is quartiles across everyone who opted in — never a person." Both halves
// are now drawn: an unshared field is a VOID (no numeral, so it can never be misread as a zero), and
// the band is a box plot, which has no prop that could carry a name.

import { WhyChip } from "@/components/org/viz";
import { CareShapeRow, type CareBandGap } from "./CareShapeRow";
import { CARE_SHAPE_ORDER, type DeveloperView } from "@/lib/org/developer-view";

const SPAN_HINT =
  "The org strip runs p25 → p75 with the median marked: three shared points, not a full " +
  "distribution, so its ends are quartiles rather than the smallest and largest values. The dot is you.";

export function CareSessionShape({ personal }: { personal: DeveloperView }) {
  const shared = new Set(personal.sharedFields);
  const bands = personal.orgBands;
  // Two different reasons a row has no strip, and they must not share an encoding: comparison never
  // switched on at all, versus switched on with nobody else's numbers to make a band out of.
  const gap: CareBandGap = bands === null ? "comparison-off" : "no-band";
  const plotted = CARE_SHAPE_ORDER.filter((f) => shared.has(f) && personal.shape[f] != null && bands?.[f]).length;

  return (
    <div className="mt-3">
      {plotted > 0 && (
        <div className="flex justify-end">
          <WhyChip hint={SPAN_HINT} label="what the strip spans" align="end" />
        </div>
      )}
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {CARE_SHAPE_ORDER.map((field) => (
          <CareShapeRow
            key={field}
            field={field}
            value={personal.shape[field]}
            shared={shared.has(field)}
            band={bands?.[field]}
            gap={gap}
          />
        ))}
      </div>
    </div>
  );
}
