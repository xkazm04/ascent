// The Prism composition of the Passports tab. Same data as v1. A masthead states the fleet, then the
// client switcher renders Baseline, Clearance, Capabilities and Doctor checks from the kit.
import { Frame, Lede, Masthead } from "@/components/kit";
import { passportFigures } from "./passportFigures";
import type { PassportsData } from "./passportData";
import { PassportsSwitcherV2 } from "./PassportsSwitcher.v2";

export function passportsV2(d: PassportsData) {
  const { rows, scope } = d;
  const n = rows.length;
  return (
    <div data-role="passports-v2" className="space-y-8">
      <Masthead
        pattern="spectral"
        eyebrow="Passports"
        statement="Readiness across"
        named={n === 1 ? "1 passport" : `${n} passports`}
        lede="What an agent can change, beside what is safe to ship. A quadrant isolates a cohort."
        figures={n > 0 ? passportFigures(rows) : []}
        aside={scope}
      />
      {n === 0 ? (
        <Frame>
          <Lede>
            No passports yet for this view. Passports are produced by scans, so scan some of this org&apos;s repositories (or widen the segment filter), and each scan adds its repo here.
          </Lede>
        </Frame>
      ) : (
        <PassportsSwitcherV2 {...d} />
      )}
    </div>
  );
}
