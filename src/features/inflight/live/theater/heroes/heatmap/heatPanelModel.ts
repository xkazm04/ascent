// What one lane panel SAYS — pure, so every state is pinned without a renderer.
//
// The panel's words are few and big: the repo, the phase, how long in it, the file being touched
// (only while the touch is fresh — a quiet agent names no file), the diff so far, and one caption
// that says exactly what the map is built from ("seen by this screen since 12:03").

import { PHASE_QUIET_MS, type LanePhase, type LanePulse } from "@/lib/local/runner-types";
import { fmtClock, fmtDuration, repoShort, since, toMs } from "../../theaterFormat";
import { lanePhaseWords } from "../../theaterHeaderModel";
import { fileTone } from "./heatStyle";
import type { RepoHeat, TouchKind } from "./heatTypes";

export interface PanelModel {
  repo: string;
  phase: string;
  /** "for 37 s", or null when the phase has no start or the words already say the silence. */
  inPhase: string | null;
  tone: string;
  /** The file touched in the last `PHASE_QUIET_MS`, with its kind. */
  touching: { path: string; kind: TouchKind } | null;
  diff: { plus: number; minus: number; files: number } | null;
  /** "11 files · 6 folders" */
  extent: string | null;
  /** "seen by this screen since 12:03" */
  sinceWords: string | null;
  /** "time box 82 % used" once past three quarters (time used — not work done). */
  timeBox: string | null;
  /** True in the phases where an agent session is in the files — the only time the map may point. */
  live: boolean;
  /** True when the current session has opened nothing this screen saw. */
  untouched: boolean;
  planning: boolean;
}

const PHASE_TONE: Partial<Record<LanePhase, string>> = {
  "agent-reading": "text-accent-soft",
  "agent-editing": "text-orange-300",
  "agent-quiet": "text-slate-400",
  committing: "text-success-soft",
  landing: "text-success-soft",
  held: "text-amber-300",
  error: "text-danger",
};

/** Phases in which an agent session is touching files — the only ones that may name a file. */
const TOUCHING_PHASES: ReadonlySet<LanePhase> = new Set(["planning", "baseline", "agent-reading", "agent-editing", "agent-thinking"]);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The newest fresh touch of THIS session: the file whose newest known touch is youngest, if it
 *  happened after the session began and under the quiet line. An earlier session's file is not
 *  "being touched" by a planner that has opened nothing. */
function freshTouch(repo: RepoHeat | null, now: number): PanelModel["touching"] {
  let best: { path: string; kind: TouchKind; at: number } | null = null;
  const from = repo?.session?.startMs ?? Number.NEGATIVE_INFINITY;
  for (const f of repo?.files ?? []) {
    const at = Math.max(f.readAt ?? -Infinity, f.editAt ?? -Infinity);
    if (!Number.isFinite(at) || at < from || (best && at <= best.at)) continue;
    best = { path: f.path, kind: fileTone(f, now).kind, at };
  }
  return best && now - best.at < PHASE_QUIET_MS ? { path: best.path, kind: best.kind } : null;
}

export function panelModel(lane: LanePulse | null, repo: RepoHeat | null, now: number): PanelModel {
  const name = repoShort(lane?.repo ?? repo?.repo ?? "");
  const files = repo?.files ?? [];
  const folders = new Set(files.map((f) => f.module)).size;
  const extent = files.length ? `${plural(files.length, "file", "files")} · ${plural(folders, "folder", "folders")}` : null;
  const opened = repo ? fmtClock(new Date(repo.since).toISOString()) : null;
  const sinceWords = opened ? `seen by this screen since ${opened}` : null;
  if (!lane) {
    const last = repo?.lastTouchAt != null ? `last touch ${fmtDuration(Math.max(0, now - repo.lastTouchAt))} ago` : null;
    return {
      repo: name,
      phase: "No lane running",
      inPhase: last,
      tone: "text-slate-400",
      touching: null,
      diff: null,
      extent,
      sinceWords,
      timeBox: null,
      live: false,
      untouched: false,
      planning: false,
    };
  }
  const inPhaseMs = since(lane.phaseSince, now);
  const start = toMs(lane.startedAt);
  const end = toMs(lane.deadlineAt);
  const used = start != null && end != null && end > start ? (now - start) / (end - start) : null;
  return {
    repo: name,
    phase: lanePhaseWords(lane, now),
    inPhase: lane.phase !== "agent-quiet" && inPhaseMs != null ? `for ${fmtDuration(inPhaseMs)}` : null,
    tone: PHASE_TONE[lane.phase] ?? "text-white",
    touching: TOUCHING_PHASES.has(lane.phase) ? freshTouch(repo, now) : null,
    live: TOUCHING_PHASES.has(lane.phase),
    diff: lane.diffStat,
    extent,
    sinceWords,
    timeBox: used != null && used >= 0.75 ? `time box ${Math.min(100, Math.round(used * 100))} % used` : null,
    untouched: (repo?.session?.touches ?? 0) === 0,
    planning: lane.phase === "planning",
  };
}
