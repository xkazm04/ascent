// THE DRIVE REGISTRY — the process-local half of a drive: which drives THIS process is pulling, with
// their cooperative stop flags. Everything serializable is mirrored onto the LoopDrive row.
//
// Its own module (spark theater-upgrade, 2026-09-18) so the bounded driver (`drive.ts`) and the
// standing runner's control surface (`runner-control.ts`) share ONE registry without importing each
// other. On globalThis for the same reason loop-engine's `live` is: one registry per process, not per
// route chunk, so a status read from any route sees the drive another route (or the boot sweep) started.

import { isDriveLive, type DriveStatus } from "@/lib/local/drive-types";

const DRIVES_KEY = "__ascentDrives" as const;

export const drives: Map<string, DriveStatus> = ((globalThis as unknown as Record<string, unknown>)[DRIVES_KEY] ??=
  new Map<string, DriveStatus>()) as Map<string, DriveStatus>;

/** Is THIS process pulling that drive? The predicate the stale-drive sweep needs, and the reason a
 *  reconcile from a request path cannot end the drive that request is rendering. A standing runner is
 *  pulled while it waits, too — `paused` and `idle` are live, not over. */
export function isDriveLiveHere(id: string): boolean {
  const d = drives.get(id);
  return d != null && d.endedAt == null && isDriveLive(d.phase);
}

/** The in-memory drive, when this process owns it. Synchronous, for the stop path. */
export function getDrive(id: string): DriveStatus | null {
  return drives.get(id) ?? null;
}

/** The org's drive this process is pulling, if any — at most one, by `startDrive`'s single-flight. */
export function liveDriveFor(org: string): DriveStatus | null {
  const slug = org.trim().toLowerCase();
  return [...drives.values()].find((d) => d.org === slug && d.endedAt == null) ?? null;
}
