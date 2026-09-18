// The theater's FIXTURE — the pulse `?demo=1` renders and every theater test reads.
//
// A pure function of a simulated clock (`fixturePulseAt`), so the demo is DETERMINISTIC: the same
// second always shows the same lanes in the same phases, which is what makes a screenshot of the
// prototype round reproducible and a test assertion stable. Two lanes walk a scripted 180-second
// cycle (plan → read → edit → verify → commit → land), each landing emits `landed` + `verified-close`,
// and every other cycle a plan lands in the approval inbox — so the rail, the celebrations and the
// needs-you cue all have something real to react to within the first three minutes.

import type { LanePhase, LanePulse, LoopPulse, PulseEvent, RunnerPulse } from "@/lib/local/runner-types";
import { MICROS_PER_USD } from "./theaterFormat";

/** The simulated clock's zero. Arbitrary but fixed — determinism is the point. */
export const DEMO_EPOCH = Date.parse("2026-09-18T12:00:00.000Z");
export const DEMO_CYCLE_S = 180;

export type DemoScenario = "running" | "paused-spend" | "paused-session" | "idle" | "none";
export const DEMO_SCENARIOS: readonly DemoScenario[] = ["running", "paused-spend", "paused-session", "idle", "none"];

/** `?demo=` → a scenario. `1`/`true`/unknown values read as the running script. */
export function demoScenario(raw: string | null | undefined): DemoScenario {
  return DEMO_SCENARIOS.includes(raw as DemoScenario) ? (raw as DemoScenario) : "running";
}

const iso = (ms: number) => new Date(ms).toISOString();
const usd = (n: number) => Math.round(n * MICROS_PER_USD);

export function fixtureLane(o: Partial<LanePulse> = {}): LanePulse {
  return {
    laneId: "lane-kp",
    repo: "acme/kp",
    cycle: 1,
    phase: "agent-editing",
    phaseSince: iso(DEMO_EPOCH - 95_000),
    heartbeatAt: iso(DEMO_EPOCH - 2_000),
    startedAt: iso(DEMO_EPOCH - 300_000),
    deadlineAt: iso(DEMO_EPOCH + 1_500_000),
    planStep: { index: 2, total: 4 },
    filesRead: ["src/scoring/engine.ts", "src/scoring/claims.test.ts"],
    filesEdited: ["src/scoring/claims.ts"],
    diffStat: { files: 2, plus: 48, minus: 11 },
    turns: 14,
    costMicros: usd(0.62),
    tail: [
      { at: iso(DEMO_EPOCH - 30_000), kind: "read", path: "src/scoring/engine.ts", tool: "Read", note: null },
      { at: iso(DEMO_EPOCH - 4_000), kind: "edit", path: "src/scoring/claims.ts", tool: "Edit", note: "Tighten the claim table" },
    ],
    ...o,
  };
}

export function fixtureRunner(o: Partial<RunnerPulse> = {}): RunnerPulse {
  return {
    driveId: "drive-demo",
    phase: "running",
    pausedReason: null,
    pausedUntil: null,
    startedAt: iso(DEMO_EPOCH - 3 * 3_600_000 - 12 * 60_000),
    lastBeatAt: iso(DEMO_EPOCH - 1_000),
    runsDone: 13,
    spendTodayMicros: usd(12.4),
    spendCeilingMicros: usd(100),
    repos: [],
    ...o,
  };
}

export function fixturePulse(o: Partial<LoopPulse> = {}): LoopPulse {
  return {
    org: "acme",
    at: iso(DEMO_EPOCH),
    runner: fixtureRunner(),
    run: { id: "run-14", seq: 14, phase: "running", cycle: 2, maxCycles: 3, startedAt: iso(DEMO_EPOCH - 600_000) },
    lanes: [fixtureLane()],
    waiting: [],
    needsYou: { plans: 0, pausedRepos: 0, runnerPaused: false },
    today: { verifiedCloses: 9, landed: 4, liftPoints: 6, spendMicros: usd(12.4) },
    latest: [
      { at: iso(DEMO_EPOCH - 600_000), repo: "acme/systedo", kind: "landed", headline: "systedo landed 2 fixes" },
      { at: iso(DEMO_EPOCH - 1_800_000), repo: "acme/kp", kind: "verified-close", headline: "kp closed D4 · cited claims" },
    ],
    ...o,
  };
}

// ── the scripted clock ───────────────────────────────────────────────────────────────────────────
const SCRIPT: readonly [until: number, phase: LanePhase][] = [
  [20, "planning"],
  [60, "agent-reading"],
  [120, "agent-editing"],
  [150, "verifying"],
  [165, "committing"],
  [180, "landing"],
];
const LANDS_AT = 170;
const FILES = {
  "acme/kp": { read: "src/scoring/engine.ts", edit: "src/scoring/claims.ts" },
  "acme/systedo": { read: "app/api/cases/route.ts", edit: "app/api/cases/validate.ts" },
} as const;

function scriptedLane(repo: keyof typeof FILES, t: number, offset: number): LanePulse {
  const local = (((t + offset) % DEMO_CYCLE_S) + DEMO_CYCLE_S) % DEMO_CYCLE_S;
  const idx = SCRIPT.findIndex(([until]) => local < until);
  const [, phase] = SCRIPT[idx]!;
  const from = idx === 0 ? 0 : SCRIPT[idx - 1]![0];
  const cycleStart = DEMO_EPOCH + (t - local) * 1000;
  const f = FILES[repo];
  const editing = local >= 60;
  return fixtureLane({
    laneId: `lane-${repo.split("/")[1]}`,
    repo,
    phase,
    phaseSince: iso(cycleStart + from * 1000),
    heartbeatAt: iso(DEMO_EPOCH + t * 1000),
    startedAt: iso(cycleStart),
    deadlineAt: iso(cycleStart + 240_000),
    planStep: local >= 20 ? { index: Math.min(4, 1 + Math.floor((local - 20) / 40)), total: 4 } : null,
    filesRead: local >= 20 ? [f.read] : [],
    filesEdited: editing ? [f.edit] : [],
    diffStat: editing ? { files: 1, plus: Math.min(60, local - 50), minus: Math.min(14, Math.floor((local - 50) / 5)) } : null,
    tail: local >= 20 ? [{ at: iso(cycleStart + 20_000), kind: editing ? "edit" : "read", path: editing ? f.edit : f.read, tool: editing ? "Edit" : "Read", note: null }] : [],
  });
}

/** Every scripted event at or before `t` seconds, newest first, bounded to twelve. */
function scriptedEvents(t: number): PulseEvent[] {
  const out: PulseEvent[] = [];
  for (let k = Math.floor(t / DEMO_CYCLE_S); k >= 0 && out.length < 12; k--) {
    const base = k * DEMO_CYCLE_S;
    const at = (s: number) => iso(DEMO_EPOCH + (base + s) * 1000);
    const cycleEvents: [number, PulseEvent][] = [
      [LANDS_AT, { at: at(LANDS_AT), repo: "acme/kp", kind: "landed", headline: `kp landed run #${14 + k}` }],
      [LANDS_AT, { at: at(LANDS_AT), repo: "acme/kp", kind: "verified-close", headline: "kp closed D4 · cited claims" }],
      [LANDS_AT - 90, { at: at(LANDS_AT - 90), repo: "acme/systedo", kind: "landed", headline: `systedo landed run #${14 + k}` }],
    ];
    if (k % 2 === 1) cycleEvents.push([130, { at: at(130), repo: "acme/web", kind: "plan-pending", headline: "web: a plan splits the api module" }]);
    for (const [s, e] of cycleEvents.sort((a, b) => b[0] - a[0])) if (base + s <= t) out.push(e);
  }
  return [...out, ...fixturePulse().latest].slice(0, 12);
}

/** The whole pulse at simulated epoch-ms `simMs` for a scenario. Pure and deterministic. */
export function fixturePulseAt(simMs: number, scenario: DemoScenario = "running"): LoopPulse {
  const t = Math.max(0, Math.floor((simMs - DEMO_EPOCH) / 1000));
  const at = iso(simMs);
  if (scenario === "none") return fixturePulse({ at, runner: null, run: null, lanes: [], latest: fixturePulse().latest });
  if (scenario !== "running") {
    const midnight = new Date(simMs);
    midnight.setHours(24, 0, 0, 0);
    const runner =
      scenario === "paused-spend"
        ? fixtureRunner({ phase: "paused", pausedReason: "spend-ceiling", pausedUntil: iso(midnight.getTime()), spendTodayMicros: usd(100) })
        : scenario === "paused-session"
          ? fixtureRunner({ phase: "paused", pausedReason: "session-limit", pausedUntil: iso(simMs + 2 * 3_600_000) })
          : fixtureRunner({ phase: "idle", repos: [{ repo: "acme/kp", baseBranch: "main", paused: "dry-backoff", pausedUntil: iso(simMs + 40 * 60_000), note: null, failureStreak: 0, dryStreak: 2, lastMergeInSha: null, lastLandedSha: null, aheadOfBase: 3 }] });
    const paused = runner.phase === "paused";
    return fixturePulse({ at, runner, run: null, lanes: [], needsYou: { plans: 0, pausedRepos: 0, runnerPaused: paused } });
  }
  const landings = Math.floor((t + DEMO_CYCLE_S - LANDS_AT) / DEMO_CYCLE_S) + Math.floor((t + DEMO_CYCLE_S - 80) / DEMO_CYCLE_S);
  const plans = Math.min(3, Math.floor((t + DEMO_CYCLE_S - 130) / (2 * DEMO_CYCLE_S)));
  return fixturePulse({
    at,
    runner: fixtureRunner({ spendTodayMicros: usd(12.4 + t * 0.004) }),
    lanes: [scriptedLane("acme/kp", t, 0), scriptedLane("acme/systedo", t, 90)],
    waiting: ["acme/web"],
    needsYou: { plans: Math.max(0, plans), pausedRepos: 0, runnerPaused: false },
    today: { verifiedCloses: 9 + landings, landed: 4 + landings, liftPoints: 6 + landings, spendMicros: usd(12.4 + t * 0.004) },
    latest: scriptedEvents(t),
  });
}
