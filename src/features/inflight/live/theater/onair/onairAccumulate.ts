// THE CAMERA'S MEMORY — the file map each lane monitor shows, accumulated pulse by pulse.
//
// The pulse is a bounded window (≤ 8 files read, ≤ 8 edited, 6 events), so a session's whole map
// exists only if the screen keeps it. The Mission hero already keeps exactly that, per lane SESSION
// (`missionAccumulate.ts`: a new cycle or lane row starts from nothing, a lane that leaves is
// forgotten, `live` marks what arrived while the screen watched). The wall REUSES it and adds the one
// thing a map needs that a strip does not: a STABLE tile order. Mission re-sequences a file when its
// first edit lands (the strip moves it to the front); a map must not move a tile under the reader's
// eye, so the wall remembers each session's first-seen order and only ever appends to it.

import type { LoopPulse } from "@/lib/local/runner-types";
import { accumulate, EMPTY_ACC, type LaneAcc, type MissionAcc } from "../heroes/mission/missionAccumulate";

export interface OnAirAcc {
  mission: MissionAcc;
  /** Per lane: the session the order belongs to, and its paths in first-seen order. */
  order: Readonly<Record<string, { session: string; paths: readonly string[] }>>;
}

export const EMPTY_ONAIR: OnAirAcc = { mission: EMPTY_ACC, order: {} };

/** Fold one pulse in. Idempotent for a pulse already folded (same `at`). */
export function foldOnAir(prev: OnAirAcc, pulse: LoopPulse): OnAirAcc {
  const mission = accumulate(prev.mission, pulse);
  if (mission === prev.mission) return prev;
  const order: Record<string, { session: string; paths: readonly string[] }> = {};
  for (const [laneId, lane] of Object.entries(mission.lanes)) {
    const was = prev.order[laneId];
    const kept = was && was.session === lane.session ? was.paths : [];
    const known = new Set(kept);
    const fresh = Object.values(lane.chips)
      .filter((c) => !known.has(c.path))
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.path);
    order[laneId] = { session: lane.session, paths: fresh.length ? [...kept, ...fresh] : kept };
  }
  return { mission, order };
}

export interface MapFile {
  path: string;
  base: string;
  edited: boolean;
  /** Arrived while the screen watched — the only tile entitled to a flash. */
  live: boolean;
}

export interface MapGroup {
  dir: string;
  files: MapFile[];
}

const split = (path: string) => {
  const i = path.lastIndexOf("/");
  return i >= 0 ? { dir: path.slice(0, i), base: path.slice(i + 1) } : { dir: "", base: path };
};

/** The lane's map: files grouped by folder, folders in the order their first file arrived. */
export function mapGroups(acc: OnAirAcc, laneId: string): MapGroup[] {
  const lane: LaneAcc | undefined = acc.mission.lanes[laneId];
  const paths = acc.order[laneId]?.paths ?? [];
  if (!lane) return [];
  const groups: MapGroup[] = [];
  const byDir = new Map<string, MapGroup>();
  for (const path of paths) {
    const chip = lane.chips[path];
    if (!chip) continue;
    const { dir, base } = split(path);
    let g = byDir.get(dir);
    if (!g) {
      g = { dir, files: [] };
      byDir.set(dir, g);
      groups.push(g);
    }
    g.files.push({ path, base, edited: chip.kind === "edit", live: chip.live });
  }
  return groups;
}

/** The whole session's map is on screen (seen from before its first file, or begun while watched). */
export const mapComplete = (acc: OnAirAcc, laneId: string): boolean => acc.mission.lanes[laneId]?.complete ?? false;
