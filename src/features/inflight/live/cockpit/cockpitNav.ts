// THE COCKPIT'S OUTCOME MOVES: open a past run, replay its drift, go back to the inspector. Relocated
// out of `useCockpit` unchanged (backlog develop-2026-09-17 row 29, the same pass that moved the starts
// to `cockpitStarts.ts`) so that hook stays under the features cap. No hooks here: `useCockpit` calls
// this each render with its own state and setters, exactly as the inline closures read them.

import type { ObservatoryHistory, ObservatorySeed } from "../observatory";
import { driftFor, type CockpitDrift } from "./cockpitDrift";
import type { DriveStatus } from "./driveTypes";
import type { CockpitMode, LoopRunDetail } from "./loopTypes";

export interface CockpitNavDeps {
  loop: { live: boolean; activeId: string | null; loadDetail: (id: string) => Promise<LoopRunDetail | null> };
  seeds: ObservatorySeed[];
  histories: ObservatoryHistory[];
  outcome: LoopRunDetail | null;
  replay: number;
  setMode: (mode: CockpitMode) => void;
  setOutcome: (detail: LoopRunDetail | null) => void;
  setDriveOutcome: (status: DriveStatus | null) => void;
  setReplay: (n: number) => void;
  setDrift: (drift: CockpitDrift | null) => void;
}

export function cockpitNav(d: CockpitNavDeps) {
  const openRun = async (id: string) => {
    if (d.loop.live && id === d.loop.activeId) return d.setMode("run");
    const detail = await d.loop.loadDetail(id);
    if (!detail) return;
    d.setOutcome(detail);
    d.setDriveOutcome(null);
    d.setMode("outcome");
    d.setReplay(0);
    d.setDrift(driftFor(d.seeds, d.histories, detail, 0));
  };

  const replayRun = () => {
    if (!d.outcome) return;
    const next = d.replay + 1;
    d.setReplay(next);
    d.setDrift(driftFor(d.seeds, d.histories, d.outcome, next));
  };

  const backToInspect = () => {
    d.setDriveOutcome(null);
    d.setMode("inspect");
  };

  return { openRun, replayRun, backToInspect };
}
