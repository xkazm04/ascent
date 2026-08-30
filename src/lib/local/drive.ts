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
// DURABLE SINCE 2026-08-28. The registry below is still process-local — a live task and a stop flag
// cannot be serialized — but every transition is mirrored onto a LoopDrive row (src/lib/db/drives.ts),
// so a restart no longer erases the drive itself. What a restart still does NOT do is resume: the
// boot sweep reconciles the orphaned row to `interrupted`, and re-arming an agent that spends money
// is a human decision. `resumeDrive` is that decision, and it continues the chain's run count.

import { selfHosted } from "@/lib/env";
import { autopilotEnabled, resolveAgentConfig } from "@/lib/local/agent";
import { startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
import { getLoopRun, getOrgPriceList } from "@/lib/db/loop-runs-read";
import { pickDriveModel } from "@/lib/local/lane-economics";
import { createDriveRow, getDriveRow, listDriveRows, markStaleDrivesInterrupted, saveDriveRow } from "@/lib/db/drives";
import { getOrgRollup, listLocalPairings } from "@/lib/db";
import { fleetGreenness, repoGreenness } from "@/lib/maturity/green";
import {
  DRIVE_DEFAULT_MAX_RUNS,
  DRIVE_MAX_RUNS_CAP,
  DRIVE_POLL_MS,
  driveRunsDone,
  resumeParams,
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
export {
  DRIVE_DEFAULT_MAX_RUNS,
  DRIVE_MAX_RUNS_CAP,
  DRIVE_POLL_MS,
  driveRunsDone,
  isDriveLive,
  resumeParams,
} from "@/lib/local/drive-types";

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
  // Dimensions the repo's LATEST reading could not measure — D2/D3/D4 when that reading was a local
  // scan with no GitHub-side fold to carry. Demanding L5 on them would set the drive an impossible
  // target and spend its whole rope proving it, which is the failure `dry`/`ceiling` exist to avoid.
  const unmeasurableByRepo = new Map<string, string[]>();
  for (const r of rollup?.repos ?? []) {
    if (!r.latest) continue;
    dimsByRepo.set(r.fullName, r.latest.dims);
    if (r.latest.unmeasurableDims?.length) unmeasurableByRepo.set(r.fullName, r.latest.unmeasurableDims);
  }
  const perRepo = repos.map((name) => repoGreenness(name, dimsByRepo.get(name) ?? [], unmeasurableByRepo.get(name) ?? []));
  const fleet = fleetGreenness(perRepo);
  return {
    debt: fleet.totalDebt,
    green: fleet.green,
    greenCount: fleet.greenCount,
    inScope: perRepo.length,
    remaining: fleet.remaining.filter((r) => !r.unscanned).map((r) => r.fullName),
    unscanned: perRepo.filter((r) => r.unscanned).map((r) => r.fullName),
    // Carried so the cockpit can SAY which dimensions the verdict was reached without. A green light
    // standing on six dimensions is a different claim from one standing on nine, and a drive that
    // stops without disclosing the difference is the same silence this whole change removes.
    notMeasurable: perRepo
      .filter((r) => r.unmeasurable.length > 0)
      .map((r) => ({ repo: r.fullName, dims: r.unmeasurable })),
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

/** Is THIS process pulling that drive? The predicate the stale-drive sweep needs, and the reason a
 *  reconcile from a request path cannot end the drive that request is rendering. */
export function isDriveLiveHere(id: string): boolean {
  const d = drives.get(id);
  return d != null && d.endedAt == null && d.phase === "running";
}

/** The in-memory drive, when this process owns it. Synchronous, for the stop path. */
export function getDrive(id: string): DriveStatus | null {
  return drives.get(id) ?? null;
}

/** The drive, wherever it lives: this process first (it is the fresher copy while pulling), else the
 *  row a previous process left behind. */
export async function readDrive(id: string): Promise<DriveStatus | null> {
  return drives.get(id) ?? (await getDriveRow(id));
}

/**
 * An org's drives, newest first. The DB is the list; a drive this process is pulling overrides its own
 * row, because the row is only as fresh as the last mirror write and the registry is live. Falls back
 * to memory alone when there is no database, so a keyless deployment still sees its own drive.
 */
export async function listDrives(org: string): Promise<DriveStatus[]> {
  const slug = org.trim().toLowerCase();
  const mine = [...drives.values()].filter((d) => d.org === slug);
  const byId = new Map((await listDriveRows(slug)).map((d) => [d.id, d]));
  for (const d of mine) byId.set(d.id, d);
  return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function stopDrive(id: string): boolean {
  const d = drives.get(id);
  if (!d || d.endedAt) return false;
  d.stopRequested = true;
  void saveDriveRow(d);
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
  // Reconcile BEFORE the single-flight check, exactly as startLoopRun does: a row left `running` by a
  // dead process would otherwise bar the org from ever starting another drive.
  await markStaleDrivesInterrupted(org, isDriveLiveHere);
  if ([...drives.values()].some((d) => d.org === org && !d.endedAt)) {
    throw new Error("A drive is already running for this organization.");
  }

  const scope =
    input.repos && input.repos.length > 0
      ? input.repos
      : (await listLocalPairings(org)).filter((p) => p.watched && p.localPath != null).map((p) => p.fullName);
  if (scope.length === 0) throw new Error("Nothing to drive: no watched, paired repositories in scope.");

  // One configuration for the whole drive, resolved here and inherited by every run it dispatches —
  // a drive that changed model between runs would make its own debt-before/after ledger a comparison
  // of two setups rather than of two states of the fleet.
  const agent = resolveAgentConfig({ model: input.model, effort: input.effort });
  const maxRuns = Math.min(DRIVE_MAX_RUNS_CAP, Math.max(1, input.maxRuns ?? DRIVE_DEFAULT_MAX_RUNS));
  const runsBefore = Math.max(0, Math.trunc(input.runsBefore ?? 0));
  if (runsBefore >= maxRuns) throw new Error("This drive's run budget is already spent — raise it to drive again.");
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
    runsBefore,
    resumedFrom: input.resumedFrom ?? null,
    model: agent.model,
    effort: agent.effort,
    startedAt: nowIso(),
    endedAt: null,
    error: null,
    stopRequested: false,
  };
  drives.set(status.id, status);
  await createDriveRow(status, input.actor ?? null);
  void drive(status, input.actor ?? null).catch(async (err) => {
    status.phase = "error";
    status.error = err instanceof Error ? err.message : String(err);
    status.endedAt = nowIso();
    await saveDriveRow(status);
  });
  return status;
}

/**
 * Re-arm an interrupted drive as a NEW drive continuing the same chain.
 *
 * Deliberately not automatic. The interrupted drive stays interrupted (its row is the record of what
 * that segment did); the new one inherits the scope, the bounds and — the point of the exercise — the
 * runs already spent, so the operator's rope is not silently re-granted by a server restart.
 */
export async function resumeDrive(id: string, actor: string | null): Promise<DriveStatus> {
  const prior = await readDrive(id);
  if (!prior) throw new Error("Unknown drive.");
  const params = resumeParams(prior);
  if (!params) {
    throw new Error(
      prior.phase === "interrupted"
        ? "This drive already spent its whole run budget — start a new drive with more rope."
        : `Only an interrupted drive can be resumed; this one is ${prior.phase}.`,
    );
  }
  return startDrive({ ...params, actor });
}

/**
 * The dimensions the drive still owes debt on, across the repos it is about to work.
 *
 * The price list is per-dimension, so "which model is cheaper" is only answerable against the
 * dimensions this step is actually aiming at — a model that is cheap on D9 is no argument for a step
 * that is all D2. Read from the same rollup `measureDrive` uses, so the two cannot disagree about
 * what is still open.
 */
async function debtDimensions(orgSlug: string, repos: readonly string[]): Promise<string[]> {
  const rollup = await getOrgRollup(orgSlug).catch(() => null);
  const scope = new Set(repos);
  const dims = new Set<string>();
  for (const r of rollup?.repos ?? []) {
    if (!r.latest || !scope.has(r.fullName)) continue;
    for (const gap of repoGreenness(r.fullName, r.latest.dims, r.latest.unmeasurableDims ?? []).gaps) {
      dims.add(gap.dimId);
    }
  }
  return [...dims];
}

/**
 * The model the next run should use, or `null` to keep the drive's configured one.
 *
 * Best-effort by construction: a failure to read the price list must never end a drive, so every
 * error degrades to `null` — which is the drive continuing exactly as it did before #27.
 */
async function chooseDriveModel(st: DriveStatus, m: DriveMeasurement): Promise<string | null> {
  try {
    const dims = await debtDimensions(st.org, m.remaining);
    if (dims.length === 0) return null;
    const prices = await getOrgPriceList(st.org);
    return pickDriveModel(prices, dims);
  } catch {
    return null;
  }
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
  await saveDriveRow(st);
  for (;;) {
    if (st.stopRequested) {
      st.phase = "stopped";
      break;
    }
    // The CHAIN's run count, not this segment's: a resumed drive must not be handed the whole rope
    // again just because a restart split its history in two.
    const step = nextDriveStep(m, prev, driveRunsDone(st), st.maxRuns);
    if (step.action === "stop") {
      st.phase = step.phase;
      break;
    }
    // THE MODEL CHOICE BECOMES EVIDENCE-LED, and only where there is evidence. `pickDriveModel`
    // returns null unless two models are measured at n >= 3 on every dimension this step is aiming
    // at, and null means "keep what the operator configured" — never a guess. Deliberately a
    // separate call beside `nextDriveStep` rather than a widening of it: that function is a pure,
    // heavily-tested three-branch termination policy and a model choice is not a termination reason.
    const picked = await chooseDriveModel(st, m);
    const run = await startLoopRun({
      org: st.org,
      repos: step.repos,
      maxCycles: st.maxCycles,
      concurrency: st.concurrency,
      model: picked ?? st.model,
      effort: st.effort,
      actor,
    });
    const rec: DriveRunRecord = { runId: run.id, repos: step.repos, debtBefore: m.debt, debtAfter: null, startedAt: nowIso(), endedAt: null };
    st.runs.push(rec);
    await saveDriveRow(st);
    await waitForRun(run.id, () => st.stopRequested);
    // Re-score from what the lanes persisted. This — not the run's own progress flag — decides whether
    // there is another run.
    prev = m;
    m = await measureDrive(st.org, st.repos);
    st.measurement = m;
    rec.debtAfter = m.debt;
    rec.endedAt = nowIso();
    await saveDriveRow(st);
  }
  st.endedAt = nowIso();
  await saveDriveRow(st);
}
