"use client";

// "Catch it early" — the RadarComposition (sweep detects risk blips, then mitigates them; gate flips
// FAIL → PASS) played via the shared RemotionDiagram. See risk/RadarComposition + risk/radar.

import { RemotionDiagram } from "./RemotionStage";
import { RadarComposition } from "./risk/RadarComposition";

export function RiskRadar() {
  return (
    <RemotionDiagram
      component={RadarComposition}
      legend={
        <>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#ef4444" }} />
            alert
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#22c55e" }} />
            mitigated
          </span>
        </>
      }
    />
  );
}
