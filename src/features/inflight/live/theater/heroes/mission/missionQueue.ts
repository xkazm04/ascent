// THE REST OF THE FLEET — every repo that is not a working lane, as one compact row each: waiting for a
// run slot, paused (with its reason and note), resting after dry runs, or finished this cycle. Plus the
// statement the slot makes when no lane is at work, and the text alternative for the whole hero.
// Pure: the pulse and the clock in, rows and words out.

import type { LanePulse, LoopPulse, RepoRunnerState } from "@/lib/local/runner-types";
import { fmtClock, repoShort, toMs } from "../../theaterFormat";
import { chipCounts, type MissionAcc } from "./missionAccumulate";
import { fmtClockSpan, landedFor, type LaneView } from "./missionModel";

export type RowTone = "calm" | "warn" | "good" | "bad" | "muted";

export interface QueueRow {
  key: string;
  repo: string;
  status: string;
  tone: RowTone;
  note: string | null;
  aside: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function pausedRow(r: RepoRunnerState): QueueRow {
  const wakes = fmtClock(r.pausedUntil);
  const status =
    r.paused === "dry-backoff"
      ? `Resting after ${plural(r.dryStreak, "dry run", "dry runs")}${wakes ? ` · wakes ${wakes}` : ""}`
      : r.paused === "repo-failures"
        ? `Paused — ${plural(r.failureStreak, "lane", "lanes")} failed in a row`
        : r.paused === "branch-conflict"
          ? "Paused — the runner branch conflicts with its base"
          : "Paused — dependency install failed";
  return {
    key: `paused:${r.repo}`,
    repo: repoShort(r.repo),
    status,
    tone: r.paused === "dry-backoff" ? "calm" : "warn",
    note: r.note,
    aside: r.aheadOfBase ? `${plural(r.aheadOfBase, "commit", "commits")} to merge` : null,
  };
}

function finishedRow(lane: LanePulse, pulse: LoopPulse, now: number): QueueRow {
  const landed = landedFor(lane, pulse.latest, now);
  const failed = pulse.latest.find((e) => e.repo === lane.repo && (e.kind === "failed" || e.kind === "rejected"));
  const base = { key: `lane:${lane.laneId}`, repo: repoShort(lane.repo), aside: `cycle ${lane.cycle}` };
  if (landed) return { ...base, status: `Landed${fmtClock(landed.at) ? ` · ${fmtClock(landed.at)}` : ""}`, tone: "good", note: landed.headline };
  if (lane.phase === "error") return { ...base, status: "Failed", tone: "bad", note: failed?.headline ?? null };
  return { ...base, status: "Finished — nothing landed", tone: "muted", note: failed?.headline ?? null };
}

/** Every repo not shown as a band, in the order a glance wants: trouble, then waiting, then done. */
export function queueRows(pulse: LoopPulse, finished: readonly LanePulse[], now: number): QueueRow[] {
  const banded = new Set(pulse.lanes.map((l) => l.repo));
  const paused = (pulse.runner?.repos ?? []).filter((r) => r.paused != null && !banded.has(r.repo)).map(pausedRow);
  const waiting: QueueRow[] = pulse.waiting.map((repo) => ({
    key: `waiting:${repo}`,
    repo: repoShort(repo),
    status: "Waiting for a run slot",
    tone: "calm",
    note: null,
    aside: null,
  }));
  const trouble = paused.filter((r) => r.tone === "warn");
  const resting = paused.filter((r) => r.tone !== "warn");
  return [...trouble, ...waiting, ...resting, ...finished.map((l) => finishedRow(l, pulse, now))];
}

export interface EmptyStatement {
  headline: string;
  sub: string;
  tone: RowTone;
  /** When the slot expects work again — a wall-clock instant the runner itself set, never a guess. */
  wake: { label: string; clock: string; inMs: number } | null;
}

function wakeAt(label: string, iso: string | null | undefined, now: number): EmptyStatement["wake"] {
  const at = toMs(iso);
  const clock = fmtClock(iso);
  return at != null && clock != null && at > now ? { label, clock, inMs: at - now } : null;
}

/** What the slot says when no lane is at work — never an empty frame (`content-bearing-degradation`). */
export function emptyStatement(pulse: LoopPulse, now: number): EmptyStatement {
  const r = pulse.runner;
  if (!r) return { headline: "No runner is reporting", sub: "Start the standing runner from the Live tab.", tone: "muted", wake: null };
  if (r.phase === "paused") {
    const why = r.pausedReason === "spend-ceiling" ? "the day's spend ceiling" : r.pausedReason === "session-limit" ? "the session limit" : "a breaker";
    return { headline: "No lane at work", sub: `Paused on ${why}. Nothing dispatches while paused.`, tone: "warn", wake: wakeAt("resumes", r.pausedUntil, now) };
  }
  if (r.phase === "idle") {
    const next = r.repos
      .map((x) => x.pausedUntil)
      .filter((u): u is string => (toMs(u) ?? 0) > now)
      .sort((a, b) => (toMs(a) ?? 0) - (toMs(b) ?? 0))[0];
    return { headline: "No lane at work", sub: "Every repo is resting after dry runs.", tone: "calm", wake: wakeAt("next repo wakes", next, now) };
  }
  if (r.phase === "running") {
    return { headline: "Between runs", sub: pulse.waiting.length ? "Repos are waiting for a run slot." : "Preparing the next run.", tone: "calm", wake: null };
  }
  return { headline: "No lane at work", sub: r.phase === "error" ? "The runner stopped on an error." : "The runner is stopped.", tone: "muted", wake: null };
}

/** The hero's text alternative: one sentence per lane, one per row. */
export function summaryLines(views: readonly LaneView[], rows: readonly QueueRow[], acc: MissionAcc): string[] {
  const lanes = views.map((v) => {
    const { total, edited } = chipCounts(acc.lanes[v.lane.laneId]);
    const time = v.ring ? `${fmtClockSpan(v.ring.elapsedMs)} of ${fmtClockSpan(v.ring.budgetMs)} used` : null;
    const diff = v.lane.diffStat ? `+${v.lane.diffStat.plus} −${v.lane.diffStat.minus} in ${plural(v.lane.diffStat.files, "file", "files")}` : null;
    const files = total ? `${plural(total, "file", "files")} touched, ${edited} edited, since this screen opened` : null;
    return [`${repoShort(v.lane.repo)}: ${v.word}${v.sub ? ` (${v.sub})` : ""}`, time, files, diff].filter(Boolean).join("; ");
  });
  return [...lanes, ...rows.map((r) => `${r.repo}: ${r.status}${r.note ? ` — ${r.note}` : ""}`)];
}
