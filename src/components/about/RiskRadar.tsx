"use client";

// "Catch it early" — the RadarComposition (sweep detects risk blips, then mitigates them; gate flips
// FAIL → PASS) played via the shared RemotionStage. See risk/RadarComposition + risk/radar.

import { RemotionStage } from "./RemotionStage";
import { RadarComposition } from "./risk/RadarComposition";
import { W, H, FPS, DURATION } from "./risk/radar";

export function RiskRadar() {
  return (
    <RemotionStage
      component={RadarComposition}
      durationInFrames={DURATION}
      fps={FPS}
      width={W}
      height={H}
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
