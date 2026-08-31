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
import type { DriveMeasurement, DriveRunRecord, DriveStatus } from "@/lib/local/drive-types";

/** The reason written onto a row the sweep reconciles. Exported so the UI and its tests read one copy. */
export const DRIVE_INTERRUPTED_REASON =
  "Interrupted — the server restarted while this drive was pulling. Resume it to continue against the same run budget.";

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

/**
 * Row → the SAME `DriveStatus` the in-memory registry hands out, so a status read cannot tell whether
 * it came from this process or from the database. `org` is carried on the status but stored as
 * `orgId`, so the caller supplies the slug it already resolved.
 */
export function toDriveStatus(row: DriveRow, orgSlug: string): DriveStatus {
  return {
    id: row.id,
    org: orgSlug,
    phase: row.phase as DriveStatus["phase"],
    repos: parseJson<string[]>(row.reposJson, []),
    maxRuns: row.maxRuns,
    maxCycles: row.maxCycles,
    concurrency: row.concurrency,
    runs: parseJson<DriveRunRecord[]>(row.runsJson, []),
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
  runsJson: JSON.stringify(st.runs),
  measurementJson: st.measurement ? JSON.stringify(st.measurement) : null,
  stopRequested: st.stopRequested,
  model: st.model ?? null,
  effort: st.effort ?? null,
  delivery: st.delivery ?? null,
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
 * Reconcile `running` drive rows that no live process is pulling. Exactly the contract
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
    .findMany({ where: { phase: "running", ...(orgId ? { orgId } : {}) }, select: { id: true } })
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
