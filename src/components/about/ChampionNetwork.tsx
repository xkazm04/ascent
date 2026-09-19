"use client";

// "Spread what works" — the ChampionComposition (practices propagate from champions, healing weak
// links) played via the shared RemotionDiagram. See champion/ChampionComposition + champion/graph.

import { RemotionDiagram } from "./RemotionStage";
import { ACCENT, WEAK } from "./compositionShared";
import { ChampionComposition } from "./champion/ChampionComposition";
import { NODES } from "./champion/graph";

export function ChampionNetwork() {
  return (
    <div>
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
      {/* Same Illustrative chrome as RoiSimulator: invented graph, labelled where it renders. */}
      <p className="mt-3 text-center type-label tracking-[0.22em] text-slate-600">
        Illustrative · {NODES.length} sample contributors, not customer data
      </p>
    </div>
  );
}
