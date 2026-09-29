// The masthead's status line as DATA, shared by v1 and v2 of the cockpit header so the two never phrase the same
// fact differently. Pure. `driveCaption` wins over the run's lane count (a drive stays live between runs, when
// there is momentarily no active run); "at rest" is said only when neither is on.
import type { LoopRunRecord } from "./loopTypes";

export type StatusPart = { key: string; text: string; live: boolean };

export function headerStatus(p: { fleetCount: number; active: LoopRunRecord | null; laneCount: number; live: boolean; driveCaption?: string | null }): StatusPart[] {
  const parts: StatusPart[] = [{ key: "fleet", text: `${p.fleetCount} repos`, live: false }];
  if (p.driveCaption) parts.push({ key: "drive", text: p.driveCaption, live: true });
  if (p.live && p.active) {
    parts.push({ key: "run", text: `${p.laneCount} ${p.laneCount === 1 ? "lane" : "lanes"} · cycle ${p.active.cycle}/${p.active.maxCycles}`, live: true });
  } else if (!p.driveCaption) {
    parts.push({ key: "rest", text: "at rest", live: false });
  }
  return parts;
}
