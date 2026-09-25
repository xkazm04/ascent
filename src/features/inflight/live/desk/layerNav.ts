// Where prev/next lead on each inner page — pure. Rounds walk in time; lanes walk across the whole
// history in reading order (so the lane after a round's last lane is the next round's first); Waiting
// pages walk the cards in rank order; arms walk the league.

import type { ArmRow } from "./armsModel";
import type { NavTarget } from "./DocParts";
import { repoShort } from "./deskFormat";
import type { RoundLane } from "./deskTypes";
import type { RoundsFold } from "./roundsModel";
import type { WaitCard } from "./waitingModel";

export const laneName = (repo: string, cycle: number): string => `${repoShort(repo)} · cycle ${cycle}`;

export function roundNav(fold: RoundsFold | null, runId: string): { prev: NavTarget | null; next: NavTarget | null } {
  const i = fold ? fold.rounds.findIndex((r) => r.id === runId) : -1;
  if (!fold || i < 0) return { prev: null, next: null };
  const at = (j: number): NavTarget | null => {
    const r = fold.rounds[j];
    return r ? { label: `Round ${r.label}`, short: r.label, to: { kind: "round", runId: r.id } } : null;
  };
  return { prev: at(i - 1), next: at(i + 1) };
}

export function allLanes(fold: RoundsFold | null): { lane: RoundLane; seq: number | null; label: string }[] {
  return (fold?.rounds ?? []).flatMap((r) => r.lanes.map((lane) => ({ lane, seq: r.seq, label: r.label })));
}

export function laneNav(fold: RoundsFold | null, laneId: string, kind: "lane" | "log"): { prev: NavTarget | null; next: NavTarget | null } {
  const lanes = allLanes(fold);
  const i = lanes.findIndex((x) => x.lane.id === laneId);
  if (i < 0) return { prev: null, next: null };
  const at = (j: number): NavTarget | null => {
    const x = lanes[j];
    if (!x) return null;
    return {
      label: `${x.label} ${laneName(x.lane.repo, x.lane.cycle)}`,
      short: kind === "log" ? "log" : `${x.label} ${repoShort(x.lane.repo)} c${x.lane.cycle}`,
      to: { kind, runId: x.lane.runId, laneId: x.lane.id },
    };
  };
  return { prev: at(i - 1), next: at(i + 1) };
}

export function waitNav(cards: readonly WaitCard[], key: string): { prev: NavTarget | null; next: NavTarget | null } {
  const doors = cards.filter((c) => !c.calm || c.key === key);
  const i = doors.findIndex((c) => c.key === key);
  const at = (j: number): NavTarget | null => {
    const c = i < 0 ? null : doors[j];
    return c ? { label: c.cap, to: { kind: "wait", key: c.key } } : null;
  };
  return { prev: at(i - 1), next: at(i + 1) };
}

export function armNav(arms: readonly ArmRow[], key: string): { prev: NavTarget | null; next: NavTarget | null } {
  const i = arms.findIndex((a) => a.key === key);
  const at = (j: number): NavTarget | null => {
    const a = i < 0 ? null : arms[j];
    return a ? { label: a.key, short: j < i ? "prev arm" : "next arm", to: { kind: "arm", key: a.key } } : null;
  };
  return { prev: at(i - 1), next: at(i + 1) };
}
