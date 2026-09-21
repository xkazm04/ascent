// What a STANDING RUNNER (a `continuous` drive) means on screen, as pure functions — the runner panel,
// the header caption and the terminal banner are straight renderings of these (spark theater-upgrade,
// 2026-09-18).
//
// A runner is not a drive with a bigger rope, and nothing here may read like one: it has no run cap
// (so no "of N"), no target (so no "green", "dry" or "ceiling" — those are a BOUNDED drive's three
// honest stops) and it does not end on its own. It PAUSES, on a named breaker, and every pause says
// which breaker and until when, in the same words the theater uses (`../theater/theaterFormat`).
//
// No clock of its own. Uptime is measured to the runner's last BEAT (`lastBeatAt`, the server's own
// stamp), not to the browser's `Date.now()` — so a runner whose server went quiet shows an uptime that
// stops growing, which is the truth, and a render stays pure.

import { REPO_FAILURE_STREAK, RUNNER_BRANCH, type RepoPauseReason, type RepoRunnerState, type RunnerPauseReason } from "@/lib/local/runner-types";
import { fmtClock, fmtDuration, fmtUsd, repoShort, toMs } from "../theater/theaterFormat";
import { driveRunsDone, type DriveStatus } from "./driveTypes";

/** A continuous drive — the standing runner. Absent `mode` is a bounded drive (every row before it). */
export const isRunner = (d: Pick<DriveStatus, "mode"> | null | undefined): boolean => d?.mode === "continuous";

export const RUNNER_PAUSE_WORDS: Record<RunnerPauseReason, string> = {
  "spend-ceiling": "spend ceiling",
  "session-limit": "session limit",
};

export const REPO_PAUSE_WORDS: Record<RepoPauseReason, string> = {
  "repo-failures": `${REPO_FAILURE_STREAK} failed lanes`,
  "branch-conflict": "branch conflict",
  "dry-backoff": "dry — backing off",
  "dependency-install": "dependency install failed",
};

export type RunnerTone = "live" | "warn" | "muted" | "danger";

export interface RunnerPhaseView {
  /** "Running" · "Paused — spend ceiling until 00:00" · "Idle — next repo wakes 14:20" · "Stopped". */
  label: string;
  tone: RunnerTone;
  /** Something is still pulling it — `paused` and `idle` are waits, not ends. */
  live: boolean;
}

/** The earliest moment a TIMED repo pause lifts (dry backoff) — when an idle runner next has work. */
export function nextWake(states: readonly RepoRunnerState[]): string | null {
  let best: string | null = null;
  for (const s of states) {
    if (s.paused == null || s.pausedUntil == null) continue;
    const t = toMs(s.pausedUntil);
    if (t != null && (best == null || t < toMs(best)!)) best = s.pausedUntil;
  }
  return best;
}

export function runnerPhase(drive: DriveStatus): RunnerPhaseView {
  switch (drive.phase) {
    case "running":
      return { label: "Running", tone: "live", live: true };
    case "paused": {
      const why = drive.pausedReason ? RUNNER_PAUSE_WORDS[drive.pausedReason] : "a breaker";
      const until = fmtClock(drive.pausedUntil);
      return { label: `Paused — ${why}${until ? ` until ${until}` : ""}`, tone: "warn", live: true };
    }
    case "idle": {
      const at = fmtClock(nextWake(drive.repoState ?? []));
      // Idle with no timed wake means every repo is held for the operator — say who it is waiting on.
      return { label: at ? `Idle — next repo wakes ${at}` : "Idle — every repo waits for you", tone: "muted", live: true };
    }
    case "stopped":
      return { label: "Stopped", tone: "muted", live: false };
    case "interrupted":
      return { label: "Interrupted", tone: "warn", live: false };
    case "error":
      return { label: "Failed", tone: "danger", live: false };
    default:
      return { label: drive.phase, tone: "muted", live: false };
  }
}

/** The breaker's own sentence — the newest `paused` event's note ("Today's lane spend ($101.20)
 *  reached …"), while the runner is paused. Null when it is not, or the event was trimmed. */
export function pauseNote(drive: DriveStatus): string | null {
  if (drive.phase !== "paused") return null;
  const events = drive.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.event === "paused") return events[i]!.note || null;
  return null;
}

export interface RunnerFigures {
  /** Start to last beat; null before the first beat. */
  uptime: string | null;
  runsDone: number;
  /** Lanes delivered onto the runner branch, over the runs that counted them; null when none did. */
  landed: number | null;
  verifiedCloses: number | null;
  /** "$100.00 / day", or null for no ceiling. The status carries no spend-so-far figure. */
  ceiling: string | null;
}

const sumOf = (xs: readonly (number | null | undefined)[]): number | null =>
  xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null;

export function runnerFigures(drive: DriveStatus): RunnerFigures {
  const start = toMs(drive.startedAt);
  const beat = toMs(drive.lastBeatAt ?? drive.endedAt ?? null);
  return {
    uptime: start != null && beat != null ? fmtDuration(beat - start) : null,
    runsDone: driveRunsDone(drive),
    landed: sumOf(drive.runs.map((r) => r.landed)),
    verifiedCloses: sumOf(drive.runs.map((r) => r.verifiedCloses)),
    ceiling: drive.spendCeilingMicros != null && drive.spendCeilingMicros > 0 ? `${fmtUsd(drive.spendCeilingMicros)} / day` : null,
  };
}

export interface RunnerRepoRow {
  repo: string;
  short: string;
  base: string | null;
  ahead: number | null;
  /** "3 failed lanes" / "branch conflict" …, or null while the repo is working. */
  pause: string | null;
  /** When a timed pause lifts, as a wall-clock time; null for one only the operator lifts. */
  until: string | null;
  note: string | null;
  /** "2 failed in a row · 1 dry run", or null when both streaks are zero. */
  streaks: string | null;
  /** Any paused repo can be resumed by hand (`resume-repo`), a dry backoff included. */
  resumable: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One row per repo in scope, in the drive's own order; a repo with no state yet reads as working. */
export function runnerRepoRows(drive: DriveStatus): RunnerRepoRow[] {
  const byRepo = new Map((drive.repoState ?? []).map((s) => [s.repo, s]));
  return drive.repos.map((repo) => {
    const s = byRepo.get(repo);
    const streaks = [
      s && s.failureStreak > 0 ? `${s.failureStreak} failed in a row` : null,
      s && s.dryStreak > 0 ? plural(s.dryStreak, "dry run", "dry runs") : null,
    ].filter(Boolean);
    return {
      repo,
      short: repoShort(repo),
      base: s?.baseBranch ?? null,
      ahead: s?.aheadOfBase ?? null,
      pause: s?.paused ? REPO_PAUSE_WORDS[s.paused] : null,
      until: s?.paused ? fmtClock(s.pausedUntil) : null,
      note: s?.paused ? s.note : null,
      streaks: streaks.length > 0 ? streaks.join(" · ") : null,
      resumable: s?.paused != null,
    };
  });
}

/** The masthead's one line while a drive pulls. A bounded drive keeps the words it always had. */
export function driveHeaderCaption(drive: DriveStatus | null, live: boolean): string | null {
  if (!live || !drive) return null;
  if (!isRunner(drive)) return `drive · run ${drive.runs.length}/${drive.maxRuns}`;
  const phase = runnerPhase(drive).label;
  return `runner · ${phase.charAt(0).toLowerCase()}${phase.slice(1)} · ${plural(driveRunsDone(drive), "run", "runs")}`;
}

const KEEPS = `Verified work already on each repo's ${RUNNER_BRANCH} branch stays there until you merge it.`;

/** What pressing Stop does to a runner — true to `runContinuous`: a waiting runner stops at its next
 *  beat; a working one stops the run it is waiting on, whose lanes wind down cooperatively. */
export function runnerStopHint(drive: DriveStatus): string {
  if (drive.phase === "paused" || drive.phase === "idle") {
    return `Stops the runner at its next beat, within a minute — nothing is running while it waits. ${KEEPS}`;
  }
  return `Stops the runner and the run it is waiting on: no further run starts, and the in-flight lanes finish the stage they are in, then are force-stopped after a short grace. ${KEEPS}`;
}
