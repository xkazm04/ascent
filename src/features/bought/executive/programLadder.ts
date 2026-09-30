// Rungs of the transition program, as ladder states. Unknown standing is unmeasured, never a fake L1.
import { LEVELS, levelForScore } from "@/lib/maturity/model";
import type { LadderStep, LadderState } from "@/components/kit";
import type { LevelId } from "@/lib/types";

export function programLadderSteps(now: number | null, target: LevelId): LadderStep[] {
  const standing = typeof now === "number" && Number.isFinite(now) ? levelForScore(now).id : null;
  const at = standing ? LEVELS.findIndex((l) => l.id === standing) : -1;
  return LEVELS.map((l, i) => {
    let state: LadderState = "unmeasured";
    if (at >= 0) state = i < at ? "reached" : i === at ? "current" : "open";
    return {
      key: l.id,
      label: `${l.id} ${l.name}`,
      state,
      detail: l.id === target ? "target" : undefined,
    };
  });
}
