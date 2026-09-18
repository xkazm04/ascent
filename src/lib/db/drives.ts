// LOOP DRIVES — durable persistence for the drive layer (src/lib/local/drive.ts).
//
// The same argument loop-runs.ts makes for runs, one level up. A drive's RUNS were always durable, so
// what happened survived a restart; the drive's intent to continue did not, and neither did the fact
// that a drive had ever existed. A `GET` after a restart therefore reported nothing at all — not
// "interrupted", not "it ran twice and burned 40 points": nothing — which is the one answer that is
// never true.
//
// So the row is the source of truth for everything serializable (scope, rope, the per-run debt
// ledger, the latest measurement) and the process registry in drive.ts keeps only the cooperative
// stop flag and the task actually pulling. A `running` row this process is not driving is, by
// construction, a restart casualty: markStaleDrivesInterrupted reconciles it to `interrupted`.
//
// Writes are whole-row: a drive changes state a handful of times per HOUR (a run takes minutes), so
// there is nothing to gain from patch granularity and something to lose — a status assembled from
// partial writes can disagree with itself.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeDelivery } from "@/lib/local/delivery-options";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { DriveEventRecord, DriveMeasurement, DriveRunRecord, DriveStatus } from "@/lib/local/drive-types";
import type { DriveDials, RepoRunnerState } from "@/lib/local/runner-types";

/** The reason written onto a row the sweep reconciles. Exported so the UI and its tests read one copy. */
export const DRIVE_INTERRUPTED_REASON =
  "Interrupted — the server restarted while this drive was pulling. Resume it to continue against the same run budget.";

/** The reason a STANDING RUNNER is interrupted instead of re-attached at boot: the loop is off. */
export const RUNNER_AUTOPILOT_OFF_REASON =
  "Interrupted — the server restarted with the loop switched off (ASCENT_AUTOPILOT), so the standing runner was not re-attached. Turn the loop back on and resume it.";

/** The largest daily ceiling `LoopDrive.spendCeilingMicros` (a 32-bit `Int`) can hold: ~$21.47 in
 *  micro-cents. A larger write fails the whole row update, so the route and `startDrive` refuse one. */
export const SPEND_CEILING_STORABLE_MAX_MICROS = 2_147_483_647;

/** The phases in which something is (or should be) pulling a drive. A continuous drive also waits in
 *  `paused` and `idle`, and a row left in either by a dead process is exactly as orphaned as `running`. */
export const LIVE_DRIVE_PHASES = ["running", "paused", "idle"] as const;

type DriveRow = {
  id: string;
  orgId: string;
  createdBy: string | null;
  phase: string;
  reposJson: string;
  maxRuns: number;
  maxCycles: number;
  concurrency: number;
  runsBefore: number;
  resumedFrom: string | null;
  runsJson: string;
  measurementJson: string | null;
  stopRequested: boolean;
  model?: string | null;
  effort?: string | null;
  delivery?: string | null;
  mode?: string | null;
  pausedReason?: string | null;
  pausedUntil?: Date | null;
  spendCeilingMicros?: number | null;
  repoStateJson?: string | null;
  dialsJson?: string | null;
  lastBeatAt?: Date | null;
  startedAt: Date;
  endedAt: Date | null;
  error: string | null;
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A malformed column is a rendering crash three layers up in a React tree. The drive is already
    // over by the time anyone reads a bad row; an empty ledger is a survivable answer, a throw is not.
    return fallback;
  }
}

/** `runsJson` carries the runs AND (for a continuous drive) its events, told apart by `event`. */
function splitLedger(raw: string | null | undefined): { runs: DriveRunRecord[]; events: DriveEventRecord[] } {
  const all = parseJson<unknown[]>(raw, []);
  const list = Array.isArray(all) ? all : [];
  const isEvent = (e: unknown): e is DriveEventRecord =>
    typeof e === "object" && e !== null && typeof (e as { event?: unknown }).event === "string";
  return { runs: list.filter((e) => !isEvent(e)) as DriveRunRecord[], events: list.filter(isEvent) };
}

/**
 * Row → the SAME `DriveStatus` the in-memory registry hands out, so a status read cannot tell whether
 * it came from this process or from the database. `org` is carried on the status but stored as
 * `orgId`, so the caller supplies the slug it already resolved.
 */
export function toDriveStatus(row: DriveRow, orgSlug: string): DriveStatus {
  const ledger = splitLedger(row.runsJson);
  return {
    id: row.id,
    org: orgSlug,
    phase: row.phase as DriveStatus["phase"],
    repos: parseJson<string[]>(row.reposJson, []),
    maxRuns: row.maxRuns,
    maxCycles: row.maxCycles,
    concurrency: row.concurrency,
    runs: ledger.runs,
    measurement: parseJson<DriveMeasurement | null>(row.measurementJson, null),
    runsBefore: row.runsBefore,
    resumedFrom: row.resumedFrom,
    model: row.model ?? null,
    effort: row.effort ?? null,
    // An unrecognised column value is `null` — "unchosen" — never a guess at a mode that writes into
    // the operator's working copy.
    delivery: normalizeDelivery(row.delivery),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    error: row.error,
    stopRequested: row.stopRequested,
    // THE DIALS every run inherits — carried on either mode, since a bounded drive dropped five of them.
    ...(row.dialsJson ? { dials: parseJson<DriveDials | null>(row.dialsJson, null) } : {}),
    // THE STANDING RUNNER's fields appear ONLY on a continuous drive, so a bounded drive's status is
    // exactly the object it always was. An unrecognised mode is `bounded` — never a guess at the mode
    // that runs forever — and a pause reason is kept only when it is one of the runner's own words.
    ...(row.mode === "continuous"
      ? {
          mode: "continuous" as const,
          pausedReason:
            row.pausedReason === "spend-ceiling" || row.pausedReason === "session-limit" ? row.pausedReason : null,
          pausedUntil: row.pausedUntil ? row.pausedUntil.toISOString() : null,
          spendCeilingMicros: row.spendCeilingMicros ?? null,
          repoState: parseJson<RepoRunnerState[]>(row.repoStateJson, []),
          lastBeatAt: row.lastBeatAt ? row.lastBeatAt.toISOString() : null,
        }
      : {}),
    ...(ledger.events.length > 0 ? { events: ledger.events } : {}),
  };
}

const rowData = (st: DriveStatus) => ({
  phase: st.phase,
  reposJson: JSON.stringify(st.repos),
  maxRuns: st.maxRuns,
  maxCycles: st.maxCycles,
  concurrency: st.concurrency,
  runsBefore: st.runsBefore,
  resumedFrom: st.resumedFrom,
  // Events ride in the same ledger (see `splitLedger`); with none, the column is byte-identical to
  // every drive before them.
  runsJson: JSON.stringify(st.events && st.events.length > 0 ? [...st.runs, ...st.events] : st.runs),
  measurementJson: st.measurement ? JSON.stringify(st.measurement) : null,
  stopRequested: st.stopRequested,
  model: st.model ?? null,
  effort: st.effort ?? null,
  delivery: st.delivery ?? null,
  mode: st.mode ?? "bounded",
  pausedReason: st.pausedReason ?? null,
  pausedUntil: st.pausedUntil ? new Date(st.pausedUntil) : null,
  spendCeilingMicros: st.spendCeilingMicros ?? null,
  repoStateJson: JSON.stringify(st.repoState ?? []),
  dialsJson: st.dials ? JSON.stringify(st.dials) : null,
  lastBeatAt: st.lastBeatAt ? new Date(st.lastBeatAt) : null,
  endedAt: st.endedAt ? new Date(st.endedAt) : null,
  error: st.error,
});

/** Write the drive's first row. Returns false when there is no database or no such org — the caller
 *  keeps driving in memory rather than refusing to start over a persistence problem. */
export async function createDriveRow(st: DriveStatus, createdBy: string | null): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getOrgBySlug(st.org);
  if (!org) return false;
  const created = await getPrisma()
    .loopDrive.create({ data: { id: st.id, orgId: org.id, createdBy, startedAt: new Date(st.startedAt), ...rowData(st) } })
    .catch(() => null);
  return created != null;
}

/** Mirror the whole current status onto its row. Best-effort by design: a failed write must never
 *  take down the drive it is only observing. */
export async function saveDriveRow(st: DriveStatus): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma()
    .loopDrive.update({ where: { id: st.id }, data: rowData(st) })
    .catch(() => null);
}

export async function getDriveRow(id: string): Promise<DriveStatus | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const row = await getPrisma().loopDrive.findUnique({ where: { id } });
    if (!row) return null;
    const org = await getPrisma().organization.findUnique({ where: { id: row.orgId }, select: { slug: true } });
    return org ? toDriveStatus(row, org.slug) : null;
  }, null);
}

/** An org's drives, newest first — the same ordering `listDrives` gave from memory. */
export async function listDriveRows(orgSlug: string, limit = 20): Promise<DriveStatus[]> {
  if (!isDbConfigured()) return [];
  const slug = orgSlug.trim().toLowerCase();
  return dbReadSafe<DriveStatus[]>(async () => {
    const org = await getOrgBySlug(slug);
    if (!org) return [];
    const rows = await getPrisma().loopDrive.findMany({
      where: { orgId: org.id },
      orderBy: { startedAt: "desc" },
      take: Math.max(1, Math.min(100, Math.trunc(limit) || 20)),
    });
    return rows.map((row) => toDriveStatus(row, slug));
  }, []);
}

/**
 * Reconcile live-phase (`running`, and a runner's `paused`/`idle`) drive rows that no live process is
 * pulling. Exactly the contract
 * markStaleRunsStopped has, and the `isLive` predicate is load-bearing for the same reason: this is
 * called from the boot sweep (where a fresh process drives nothing, so the default is right) AND
 * potentially from a request path, where treating every running row as orphaned would end the drive
 * that is rendering the page.
 *
 * The drive's own RUNS are not touched here — markStaleRunsStopped owns those, and it is what
 * releases the backlog claims a dead lane left behind. Sweep runs first, then drives.
 *
 * @returns how many drives were reconciled.
 */
export async function markStaleDrivesInterrupted(
  orgSlug?: string,
  isLive: (id: string) => boolean = () => false,
): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  let orgId: string | undefined;
  if (orgSlug) {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return 0;
    orgId = org.id;
  }
  const running = await prisma.loopDrive
    .findMany({ where: { phase: { in: [...LIVE_DRIVE_PHASES] }, ...(orgId ? { orgId } : {}) }, select: { id: true } })
    .catch(() => []);
  const stale = running.filter((d) => !isLive(d.id));
  if (stale.length === 0) return 0;
  await prisma.loopDrive
    .updateMany({
      where: { id: { in: stale.map((d) => d.id) } },
      data: { phase: "interrupted", endedAt: new Date(), error: DRIVE_INTERRUPTED_REASON },
    })
    .catch(() => null);
  return stale.length;
}

/**
 * THE STANDING RUNNERS a fresh process should re-attach: continuous drives whose row still says
 * `running`, `paused` or `idle`. Read by the boot sweep BEFORE `markStaleDrivesInterrupted`, so the
 * sweep can spare them — a continuous drive is resumed on its SAME row, never interrupted (operator
 * decision, 2026-09-18). `createdBy` rides along because every run the runner dispatches is audited
 * against the person who armed it.
 */
export async function listRunnerDrivesToResume(): Promise<{ drive: DriveStatus; createdBy: string | null }[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe(async () => {
    const rows = await getPrisma().loopDrive.findMany({
      where: { mode: "continuous", phase: { in: [...LIVE_DRIVE_PHASES] }, endedAt: null },
      include: { org: { select: { slug: true } } },
    });
    return rows.map((row) => ({ drive: toDriveStatus(row, row.org.slug), createdBy: row.createdBy }));
  }, []);
}

/** Mark ONE drive interrupted with a specific reason — the runner the boot sweep may not re-attach. */
export async function markDriveInterrupted(id: string, reason: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const done = await getPrisma()
    .loopDrive.update({ where: { id }, data: { phase: "interrupted", endedAt: new Date(), error: reason } })
    .catch(() => null);
  return done != null;
}
