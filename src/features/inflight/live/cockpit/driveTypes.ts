// The DRIVE's wire shapes, as the cockpit sees them — re-exported from the server's own declaration
// (`@/lib/local/drive-types`) for exactly the reason loopTypes.ts re-exports the loop's: a second
// client copy of a status shape is how a field silently stops arriving.
//
// `DriveStatusPayload` is the one shape that exists ONLY as a route response (GET composes it), so it
// is declared here rather than next to `export const runtime`.

import type { DriveMeasurement, DrivePhase, DriveRunRecord, DriveStatus } from "@/lib/local/drive-types";

export type { DriveMeasurement, DrivePhase, DriveRunRecord, DriveStatus };
export { DRIVE_DEFAULT_MAX_RUNS, DRIVE_MAX_RUNS_CAP, isDriveLive } from "@/lib/local/drive-types";

/** GET /api/org/local/drive?org=… */
export interface DriveStatusPayload {
  enabled: boolean;
  drives: DriveStatus[];
}
