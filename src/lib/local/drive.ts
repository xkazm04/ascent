// DRIVE TO GREEN — the layer above the loop that answers "run it until the fleet is green".
//
// The loop engine (loop-engine.ts) is deliberately bounded: one run is at most LOOP_MAX_CYCLES_CAP
// cycles, and a lane that produces nothing drops out. That is the right shape for ONE session of
// work and the wrong shape for a target: 350 points of debt is not one run. So a drive is a
// sequence of runs, each re-measured against the SAME predicate the fleet's colours use
// (maturity/green.ts), with the three honest ways to stop and no fourth:
//
//   green    every repo in scope cleared the band — the target, reached
//   dry      a whole run moved nothing: debt did not fall — an agent that stalled will not un-stall by
//            being re-asked, and burning a ceiling proving that is the outcome this exists to avoid
//   ceiling  the operator's rope ran out — a bounded drive, never an open-ended agent
//
// The measurement is the verifier, not the agent's word. A run's own `progressed` flag (commits or
// trailers) never decides continuation here: after every run the fleet is re-scored from the rescans
// the lanes persisted, and only a falling debt earns another run. Together with the closure rule in
// followups.ts (a trailer is a hint; a row closes only when the rescan stops raising it AND the
// dimension moved) this is what makes the loop safe to leave alone.
//
// Process-local by design, like the loop engine's `live` registry: each run it starts is a durable
// LoopRun row, so what actually HAPPENED survives a restart; only the drive's intent to continue is
// in memory, and a restart ends the drive rather than resuming into a state it cannot verify.

import { selfHosted } from "@/lib/env";
import { autopilotEnabled } from "@/lib/local/agent";
import { startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
import { getLoopRun } from "@/lib/db/loop-runs-read";
import { getOrgRollup, listLocalPairings } from "@/lib/db";
import { fleetGreenness, repoGreenness } from "@/lib/maturity/green";
import {
  DRIVE_DEFAULT_MAX_RUNS,
  DRIVE_MAX_RUNS_CAP,
  DRIVE_POLL_MS,
  type DriveInput,
  type DriveMeasurement,
  type DriveRunRecord,
  type DriveStatus,
} from "@/lib/local/drive-types";

export type {
  DriveInput,
  DriveMeasurement,
  DrivePhase,
  DriveRunRecord,
  DriveStatus,
} from "@/lib/local/drive-types";
export { DRIVE_DEFAULT_MAX_RUNS, DRIVE_MAX_RUNS_CAP, DRIVE_POLL_MS, isDriveLive } from "@/lib/local/drive-types";

export type DriveStep = { action: "stop"; phase: "green" | "dry" | "ceiling" } | { action: "run"; repos: string[] };

/**
 * The termination policy, pure. `prev` is the measurement BEFORE the last run (null before any run).
 * Order matters and is deliberate: reaching green ends the drive even on the last permitted run; a
 * run that moved nothing ends it before the ceiling is spent proving the same thing again.
 */
export function nextDriveStep(m: DriveMeasurement, prev: DriveMeasurement | null, runsDone: number, maxRuns: number): DriveStep {
  if (m.green) return { action: "stop", phase: "green" };
  if (prev && m.debt >= prev.debt) return { action: "stop", phase: "dry" };
  if (runsDone >= maxRuns) return { action: "stop", phase: "ceiling" };
  return { action: "run", repos: m.remaining };
}

/** Score the fleet for a set of repos from their LATEST persisted scans — the same read the
 *  projects door and the fleet colours use, restricted to the drive's scope. */
export async function measureDrive(orgSlug: string, repos: readonly string[]): Promise<DriveMeasurement> {
  const rollup = await getOrgRollup(orgSlug);
  const dimsByRepo = new Map<string, { dimId: string; score: number; signalScore?: number; llmScore?: number }[]>();
  for (const r of rollup?.repos ?? []) if (r.latest) dimsByRepo.set(r.fullName, r.latest.dims);
  const perRepo = repos.map((name) => repoGreenness(name, dimsByRepo.get(name) ?? []));
  const fleet = fleetGreenness(perRepo);
  return {
    debt: fleet.totalDebt,
    green: fleet.green,
    greenCount: fleet.greenCount,
    inScope: perRepo.length,
    remaining: fleet.remaining.filter((r) => !r.unscanned).map((r) => r.fullName),
    unscanned: perRepo.filter((r) => r.unscanned).map((r) => r.fullName),
  };
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────────

// On globalThis for the same reason loop-engine's `live` is: one registry per process, not per
// route chunk, so a status read from any route sees the drive another route started.
const DRIVES_KEY = "__ascentDrives" as const;
const drives: Map<string, DriveStatus> = ((globalThis as unknown as Record<string, unknown>)[DRIVES_KEY] ??=
  new Map<string, DriveStatus>()) as Map<string, DriveStatus>;

const nowIso = () => new Date().toISOString();
const driveId = () => `drive_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function getDrive(id: string): DriveStatus | null {
  return drives.get(id) ?? null;
}

export function listDrives(org: string): DriveStatus[] {
  const slug = org.trim().toLowerCase();
  return [...drives.values()].filter((d) => d.org === slug).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function stopDrive(id: string): boolean {
  const d = drives.get(id);
  if (!d || d.endedAt) return false;
  d.stopRequested = true;
  return true;
}

/**
 * Start a drive. Same preflight as the loop it wraps, plus single-flight per org: two drives over one
 * org would race each other's runs (the engine already refuses a second concurrent run per org, so
 * the second drive would only ever fail its first step — better to say so here).
 */
export async function startDrive(input: DriveInput): Promise<DriveStatus> {
  const org = input.org.trim().toLowerCase();
  if (!selfHosted()) throw new Error("A drive only runs on a self-hosted deployment.");
  if (!autopilotEnabled()) throw new Error("The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1.");
  if (listDrives(org).some((d) => !d.endedAt)) throw new Error("A drive is already running for this organization.");

  const scope =
    input.repos && input.repos.length > 0
      ? input.repos
      : (await listLocalPairings(org)).filter((p) => p.watched && p.localPath != null).map((p) => p.fullName);
  if (scope.length === 0) throw new Error("Nothing to drive: no watched, paired repositories in scope.");

  const maxRuns = Math.min(DRIVE_MAX_RUNS_CAP, Math.max(1, input.maxRuns ?? DRIVE_DEFAULT_MAX_RUNS));
  const status: DriveStatus = {
    id: driveId(),
    org,
    phase: "running",
    repos: scope,
    maxRuns,
    maxCycles: input.maxCycles ?? 3,
    concurrency: input.concurrency ?? 2,
    runs: [],
    measurement: null,
    startedAt: nowIso(),
    endedAt: null,
    error: null,
    stopRequested: false,
  };
  drives.set(status.id, status);
  void drive(status, input.actor ?? null).catch((err) => {
    status.phase = "error";
    status.error = err instanceof Error ? err.message : String(err);
    status.endedAt = nowIso();
  });
  return status;
}

async function waitForRun(runId: string, shouldStop: () => boolean): Promise<void> {
  let stopSent = false;
  for (;;) {
    const run = await getLoopRun(runId);
    if (!run) throw new Error(`Loop run ${runId} disappeared while the drive was waiting on it.`);
    if (run.endedAt) return;
    if (shouldStop() && !stopSent) {
      stopSent = true;
      await stopLoopRun(runId);
    }
    await new Promise((r) => setTimeout(r, DRIVE_POLL_MS));
  }
}

async function drive(st: DriveStatus, actor: string | null): Promise<void> {
  let prev: DriveMeasurement | null = null;
  let m = await measureDrive(st.org, st.repos);
  st.measurement = m;
  for (;;) {
    if (st.stopRequested) {
      st.phase = "stopped";
      break;
    }
    const step = nextDriveStep(m, prev, st.runs.length, st.maxRuns);
    if (step.action === "stop") {
      st.phase = step.phase;
      break;
    }
    const run = await startLoopRun({ org: st.org, repos: step.repos, maxCycles: st.maxCycles, concurrency: st.concurrency, actor });
    const rec: DriveRunRecord = { runId: run.id, repos: step.repos, debtBefore: m.debt, debtAfter: null, startedAt: nowIso(), endedAt: null };
    st.runs.push(rec);
    await waitForRun(run.id, () => st.stopRequested);
    // Re-score from what the lanes persisted. This — not the run's own progress flag — decides whether
    // there is another run.
    prev = m;
    m = await measureDrive(st.org, st.repos);
    st.measurement = m;
    rec.debtAfter = m.debt;
    rec.endedAt = nowIso();
  }
  st.endedAt = nowIso();
}
