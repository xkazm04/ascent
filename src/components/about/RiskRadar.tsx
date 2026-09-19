"use client";

// "Catch it early" — the RadarComposition (sweep detects risk blips, then mitigates them; gate flips
// FAIL → PASS) played via the shared RemotionDiagram. See risk/RadarComposition + risk/radar.

import { RemotionDiagram } from "./RemotionStage";
import { DANGER, GREEN } from "./compositionShared";
import { RadarComposition } from "./risk/RadarComposition";
import { BLIPS } from "./risk/radar";

export function RiskRadar() {
  return (
    <div>
      <RemotionDiagram
        component={RadarComposition}
        ariaLabel="Animated diagram: a radar sweep detects risk alerts early, mitigations turn them green, and the release gate flips from fail to pass."
        legend={
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DANGER }} />
              alert
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GREEN }} />
              mitigated
            </span>
          </>
        }
      />
      {/* Same Illustrative chrome as RoiSimulator: invented sweep, labelled where it renders. */}
      <p className="mt-3 text-center type-label tracking-[0.22em] text-slate-600">
        Illustrative · {BLIPS.length} sample alerts, not customer data
      </p>
    </div>
  );
}
