// One row of the session-shape strip: your number, and where it sits in the org — or the reason
// there is no picture, encoded rather than narrated.
//
// FOUR outcomes used to collapse into two strings ("—/not shared" and "no org band"):
//
//   not shared        you never sent this field    → void. No numeral is printed at all, so a
//                                                    withheld field can never be read as a zero.
//   comparison off    you sent the field but did   → the `decided` ring: a person's choice, not a
//                     not opt into comparison        shortage of data.
//   no band yet       comparison is on, too few    → the hatch: not judged. Distinct from the ring,
//                     people shared THIS field       because "you turned it off" and "we could not
//                                                    say" are not the same fact about you.
//   band              → the quartile strip, with your own value marked.
//
// The last case is why the section stopped needing its sentence: there is no name in a box plot, so
// "quartiles across everyone who opted in — never a person" is not a promise here, it is the shape
// of the thing on screen.

import { Kicker } from "@/components/ui";
import { Distribution, StateSwatch } from "@/components/org/viz";
import {
  CARE_SHAPE_LABEL,
  CARE_SHAPE_PCT,
  careShapeValue,
  type CareBand,
  type CareShapeField,
} from "@/lib/org/developer-view";

/** Why a row has no distribution to draw. */
export type CareBandGap = "comparison-off" | "no-band";

const GAP_MARK: Record<CareBandGap, { state: "decided" | "not-judged"; label: string; title: string }> = {
  "comparison-off": {
    state: "decided",
    label: "comparison off",
    title: "You shared this count but not permission to compare it. Your decision, not a gap in the data.",
  },
  "no-band": {
    state: "not-judged",
    label: "no band yet",
    title: "Too few people in this workspace shared this field for a quartile band to exist. Not judged — never read as an average of one.",
  },
};

export function CareShapeRow({
  field,
  value,
  shared,
  band,
  gap,
}: {
  field: CareShapeField;
  value: number | null;
  shared: boolean;
  band?: CareBand;
  gap: CareBandGap;
}) {
  const label = CARE_SHAPE_LABEL[field];
  const unit = CARE_SHAPE_PCT.has(field) ? "%" : "";

  if (!shared || value == null) {
    return (
      <div>
        <Kicker tone="muted">{label}</Kicker>
        <div className="mt-1.5 flex items-center gap-2" title="You did not share this count. Nothing was measured and nothing is stored — this is not a zero.">
          <StateSwatch state="missing" />
          <span className="type-body-sm text-slate-500">not shared</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Kicker tone="muted">{label}</Kicker>
        <span className="font-mono type-mono-sm tabular-nums text-white">{careShapeValue(field, value)}</span>
      </div>
      {band ? (
        // p25 and p75 stand in for the whiskers because they are the only points the org shares;
        // inventing a tail would be exactly the confident wrongness this redesign removes. The
        // section's WhyChip says so once, rather than every row repeating it.
        <Distribution
          className="mt-1"
          min={band.p25}
          q1={band.p25}
          median={band.p50}
          q3={band.p75}
          max={band.p75}
          you={value}
          label={`${label} — you against the org's p25 to p75`}
          unit={unit}
          digits={0}
        />
      ) : (
        <div className="mt-1.5 flex items-center gap-2" title={GAP_MARK[gap].title}>
          <StateSwatch state={GAP_MARK[gap].state} />
          <span className="type-body-sm text-slate-500">{GAP_MARK[gap].label}</span>
        </div>
      )}
    </div>
  );
}
