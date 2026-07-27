"use client";

// "Spread what works" — the ChampionComposition (practices propagate from champions, healing weak
// links) played via the shared RemotionDiagram. See champion/ChampionComposition + champion/graph.

import { RemotionDiagram } from "./RemotionStage";
import { ACCENT, WEAK } from "./compositionShared";
import { ChampionComposition } from "./champion/ChampionComposition";

export function ChampionNetwork() {
  return (
    <RemotionDiagram
      component={ChampionComposition}
      ariaLabel="Animated diagram: practices spread outward from champion engineers across the team graph, strengthening weak links until the whole network adopts them."
      legend={
        <>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded" style={{ backgroundColor: ACCENT }} />
            strong link
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 border-t border-dashed" style={{ borderColor: WEAK }} />
            weak link
          </span>
        </>
      }
    />
  );
}
