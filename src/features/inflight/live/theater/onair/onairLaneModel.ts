// WHAT A LANE MONITOR SAYS — the PGM/PVW view of one lane, as a pure function of the pulse, the
// wall's memory and the clock (frozen at last contact when stale). No rendering, no hooks.
//
// Honesty, as code: the lit tile is the tail's newest file (no invented cursor); the bar is TIME
// USED of the watchdog ceiling, never work done; money a lane did not report reads "$ not recorded",
// never $0; "just landed" is claimed only from a `landed` event for the repo dated inside this lane's
// session (`landedFor`), measured on the server's own clock (`pulse.at`), so browser skew cannot fake it.

import type { LaneActivity, LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { fmtClockSpan, landedFor } from "../heroes/mission/missionModel";
import { deadlineFraction, fmtUsd, repoShort, toMs } from "../theaterFormat";
import { lanePhaseWords, lastTouched } from "../theaterHeaderModel";
import { mapComplete, mapGroups, type MapGroup, type OnAirAcc } from "./onairAccumulate";
import { fmtHms } from "./onairFormat";
import { laneWorking, litTone, phaseShort, phaseStage, type LitTone, type OnAirStage } from "./onairStages";

/** A landing earns the green tally for this long after it happened. */
export const JUST_LANDED_MS = 30_000;

export type MonitorTone = "red" | "green" | "amber" | "grey";

export interface TapeLine {
  key: string;
  time: string;
  tool: string;
  tone: LitTone | "note";
  text: string;
  isNote: boolean;
  /** Happened after the screen opened — entitled to its one entrance. */
  fresh: boolean;
}

export interface LaneMonitorView {
  laneId: string;
  repo: string;
  org: string;
  name: string;
  cycle: number;
  arm: string | null;
  tone: MonitorTone;
  stage: OnAirStage;
  phase: string;
  /** The phase in one mono-caps word ("EDITING"). */
  short: string;
  phaseWords: string;
  /** The phase changed while the screen watched — the word may flip in (once, keyed by phase). */
  phaseFlip: boolean;
  groups: MapGroup[];
  files: number;
  edited: number;
  complete: boolean;
  active: boolean;
  lit: { path: string; tone: LitTone; live: boolean } | null;
  from: string | null;
  note: { word: string; planner: string | null; exec: string | null } | null;
  tape: TapeLine[];
  tapeEmpty: string;
  path: string | null;
  used: string | null;
  total: string | null;
  frac: number | null;
  cost: string | null;
  diff: LanePulse["diffStat"];
  turns: number | null;
}

const toneOf = (lane: LanePulse, pulse: LoopPulse): MonitorTone => {
  const pulseMs = toMs(pulse.at) ?? 0;
  const landed = landedFor(lane, pulse.latest, pulseMs);
  if (landed && pulseMs - (toMs(landed.at) ?? 0) <= JUST_LANDED_MS) return "green";
  if (lane.phase === "held") return "amber";
  return laneWorking(lane.phase) ? "red" : "grey";
};

/** The newest tail event with a path, and the one before it on a different path (the trail's tail). */
function litAndFrom(tail: readonly LaneActivity[]): { lit: LaneActivity | null; from: LaneActivity | null } {
  let lit: LaneActivity | null = null;
  for (let i = tail.length - 1; i >= 0; i--) {
    const e = tail[i]!;
    if (!e.path) continue;
    if (!lit) lit = e;
    else if (e.path !== lit.path) return { lit, from: e };
  }
  return { lit, from: null };
}

function tapeOf(tail: readonly LaneActivity[], max: number, openedAt: number | null): TapeLine[] {
  const out: TapeLine[] = [];
  for (let i = tail.length - 1; i >= 0 && out.length < max; i--) {
    const e = tail[i]!;
    // An event with neither a path nor words (a bare tool call, a kiosk's withheld note) says nothing.
    if (!e.path && !e.note) continue;
    const at = toMs(e.at);
    const base = { key: `${e.at}|${e.kind}|${e.path ?? ""}|${e.note ?? ""}`, time: fmtHms(at) ?? "", fresh: openedAt != null && at != null && at > openedAt };
    out.push(
      e.path
        ? { ...base, tool: e.tool ?? e.kind, tone: litTone(e.kind), text: e.path, isNote: false }
        : { ...base, tool: "note", tone: "note", text: e.note!, isNote: true },
    );
  }
  return out;
}

export function laneMonitorView(lane: LanePulse, pulse: LoopPulse, acc: OnAirAcc, clock: number, tapeMax: number): LaneMonitorView {
  const stage = phaseStage(lane.phase);
  const active = stage === "read" || stage === "edit";
  const groups = mapGroups(acc, lane.laneId);
  const all = groups.flatMap((g) => g.files);
  const known = new Set(all.map((f) => f.path));
  const { lit, from } = litAndFrom(lane.tail);
  const litFile = lit?.path && known.has(lit.path) ? all.find((f) => f.path === lit.path)! : null;
  const mem = acc.mission.lanes[lane.laneId];
  const openedAt = acc.mission.openedAt;
  const start = toMs(lane.startedAt);
  const end = toMs(lane.deadlineAt);
  const arm = lane.arm;
  const slash = lane.repo.indexOf("/");
  return {
    laneId: lane.laneId,
    repo: lane.repo,
    org: slash > 0 ? `${lane.repo.slice(0, slash)}/` : "",
    name: repoShort(lane.repo),
    cycle: lane.cycle,
    arm: arm?.label ?? null,
    tone: toneOf(lane, pulse),
    stage,
    phase: lane.phase,
    short: phaseShort(lane.phase),
    phaseWords: lanePhaseWords(lane, clock),
    phaseFlip: mem != null && openedAt != null && mem.shown.since > openedAt,
    groups,
    files: all.length,
    edited: all.filter((f) => f.edited).length,
    complete: mapComplete(acc, lane.laneId),
    active,
    lit: litFile && lit ? { path: litFile.path, tone: litTone(lit.kind), live: litFile.live } : null,
    from: active && from?.path && known.has(from.path) ? from.path : null,
    note: all.length
      ? null
      : { word: phaseShort(lane.phase), planner: arm?.plan ? `${arm.plan.transport}:${arm.plan.model}` : null, exec: arm ? `${arm.transport}:${arm.model}` : null },
    tape: tapeOf(lane.tail, tapeMax, openedAt),
    tapeEmpty: stage === "plan" ? "planning · no tool call yet this cycle" : "no tool call yet this cycle",
    path: lastTouched(lane),
    used: start != null ? fmtClockSpan(clock - start) : null,
    total: start != null && end != null && end > start ? fmtClockSpan(end - start) : null,
    frac: deadlineFraction(lane, clock),
    cost: lane.costMicros == null ? null : fmtUsd(lane.costMicros),
    diff: lane.diffStat,
    turns: lane.turns,
  };
}
