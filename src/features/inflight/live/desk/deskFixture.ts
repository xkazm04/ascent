// Test fixtures for the desk — realistic shapes built on the ledger's factories: a handful of rounds
// over two repos with lanes of every verdict, a cost that was and was not reported, a gap that splits
// the history into two chapters, and a live pulse. Not imported by any production file.

import type { LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { at, chronicleRun, ledgerData, NOW } from "../ledger/ledgerFixture";
import type { DeskData, LoopLessonRow, RoundLane } from "./deskTypes";

export { NOW, at };

export const roundLane = (id: string, runId: string, over: Partial<RoundLane> = {}): RoundLane => ({
  id,
  runId,
  repo: "acme/kp",
  cycle: 1,
  phase: "done",
  verdict: "verified",
  closes: 1,
  commits: 1,
  costMicros: 100_000_000,
  armLabel: "claude-opus-5",
  model: "claude-opus-5",
  errored: false,
  landedAt: null,
  startedAt: at(40),
  endedAt: at(39),
  ...over,
});

export const lesson = (id: string, over: Partial<LoopLessonRow> = {}): LoopLessonRow => ({
  id,
  namespace: "acme/kp",
  content: "Run the typecheck before the unit tests.",
  kind: "lesson",
  source: "lane",
  laneId: "l1",
  status: "pending",
  promotedMemoryId: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: at(3),
  ...over,
});

/** Four rounds, newest first as the load hands them: #1–#2 two days ago, a quiet gap, #3–#4 today. */
export function deskRounds() {
  return [
    chronicleRun(4, { id: "run-4", repos: ["acme/kp", "acme/web"], startedAt: at(3), endedAt: at(2), verifiedCloses: 0, costMicros: null, lanes: 2, error: "agent crashed" }),
    chronicleRun(3, { id: "run-3", repos: ["acme/kp"], startedAt: at(5), endedAt: at(4), verifiedCloses: 5, costMicros: 300_000_000, lift: 2, lanes: 2 }),
    chronicleRun(2, { id: "run-2", repos: ["acme/kp"], startedAt: at(47), endedAt: at(46), verifiedCloses: 3, costMicros: 150_000_000, lanes: 1 }),
    chronicleRun(1, { id: "run-1", repos: ["acme/kp"], startedAt: at(49), endedAt: at(48), verifiedCloses: 0, costMicros: null, lanes: 1 }),
  ];
}

export function deskLanes(): RoundLane[] {
  return [
    roundLane("l1", "run-1", { verdict: null, closes: 0, costMicros: null, armLabel: null, model: null, startedAt: at(49) }),
    roundLane("l2", "run-2", { verdict: "baseline-unavailable", closes: 3, costMicros: 150_000_000, startedAt: at(47) }),
    roundLane("l3", "run-3", { verdict: "verified", closes: 4, costMicros: 200_000_000, startedAt: at(5) }),
    roundLane("l4", "run-3", { cycle: 2, verdict: "verified", closes: 1, costMicros: 100_000_000, startedAt: at(4.5) }),
    roundLane("l5", "run-4", { verdict: "rejected", closes: 0, costMicros: null, armLabel: "claude:sonnet plan -> pi:qwen3.8:27b", startedAt: at(3) }),
    roundLane("l6", "run-4", { repo: "acme/web", verdict: null, errored: true, phase: "error", closes: 0, costMicros: null, armLabel: "claude:sonnet plan -> pi:qwen3.8:27b", startedAt: at(2.9) }),
  ];
}

export const deskData = (over: Partial<DeskData> = {}): DeskData => ({
  ledger: ledgerData({ ahead: { "acme/kp": 3, "acme/web": null } }),
  rounds: deskRounds(),
  roundsHasMore: false,
  lanes: deskLanes(),
  pendingLessons: [lesson("x1"), lesson("x2", { namespace: "acme/web", laneId: "l6" })],
  pairedRepos: ["acme/kp", "acme/web"],
  failed: [],
  ...over,
});

export const lanePulse = (over: Partial<LanePulse> = {}): LanePulse => ({
  laneId: "lane-kp",
  repo: "acme/kp",
  cycle: 1,
  phase: "verifying",
  phaseSince: "2026-09-18T11:59:50.000Z",
  heartbeatAt: "2026-09-18T11:59:59.000Z",
  startedAt: "2026-09-18T11:58:00.000Z",
  deadlineAt: "2026-09-18T12:02:00.000Z",
  planStep: null,
  filesRead: ["src/a.ts"],
  filesEdited: ["src/scoring/claims.ts"],
  diffStat: null,
  turns: 4,
  costMicros: 62_000_000,
  tail: [],
  arm: null,
  ...over,
});

export const pulse = (over: Partial<LoopPulse> = {}): LoopPulse => ({
  org: "acme",
  at: NOW,
  runner: {
    driveId: "d1",
    phase: "running",
    pausedReason: null,
    pausedUntil: null,
    startedAt: "2026-09-18T09:00:00.000Z",
    lastBeatAt: NOW,
    runsDone: 13,
    spendTodayMicros: 1_294_400_000,
    spendCeilingMicros: 10_000_000_000,
    repos: [],
  },
  run: { id: "run-14", seq: 14, phase: "running", cycle: 2, maxCycles: 3, startedAt: "2026-09-18T11:50:00.000Z" },
  lanes: [lanePulse()],
  waiting: ["acme/web"],
  needsYou: { plans: 0, pausedRepos: 0, runnerPaused: false },
  today: { verifiedCloses: 10, landed: 5, liftPoints: null, spendMicros: 1_294_400_000 },
  latest: [],
  ...over,
});
