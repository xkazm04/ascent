"use client";

// "Spread what works" — the ChampionComposition (practices propagate from champions, healing weak
// links) played via the shared RemotionStage. See champion/ChampionComposition + champion/graph.

import { RemotionStage } from "./RemotionStage";
import { ChampionComposition } from "./champion/ChampionComposition";
import { W, H, FPS, DURATION } from "./champion/graph";

export function ChampionNetwork() {
  return (
    <RemotionStage
      component={ChampionComposition}
      durationInFrames={DURATION}
      fps={FPS}
      width={W}
      height={H}
      legend={
        <>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded" style={{ backgroundColor: "#3b9eff" }} />
            strong link
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 border-t border-dashed border-[#f87171]" />
            weak link
          </span>
        </>
      }
    />
  );
}
