import type { ScanSensorId } from "@/lib/types";

/**
 * Every sensor id the ingest phase can record. A `Record` over the union rather than an array literal,
 * so adding a sensor to `ScanSensorId` without adding it here is a compile error, not a silent drop.
 */
const KNOWN_SENSORS: Record<ScanSensorId, true> = {
  pullRequests: true,
  governance: true,
  securityPosture: true,
  securityExposure: true,
  appInventory: true,
  ciHealth: true,
  deployments: true,
};

function isScanSensorId(v: unknown): v is ScanSensorId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(KNOWN_SENSORS, v);
}

/**
 * Decode `Scan.sensorFailuresJson` onto `ScanReport.sensorFailures`, keeping three states apart:
 *
 *  - NULL, empty, malformed or non-array -> `undefined`: UNKNOWN. A row written before the column (or
 *    by a caller whose report never carried the list) must never read as "no sensor failed", because
 *    that is the claim that turns a failed read back into a confident pass on a DB-tier gate hit.
 *  - JSON `[]` -> `[]`: PROVEN. The scan ran its reads and none threw.
 *  - JSON `["governance", ...]` -> the failed reads, in stored order. Non-strings and ids that are not a
 *    known sensor (hand-edited, or renamed since) are dropped rather than cast into the typed union.
 */
export function parseSensorFailures(raw: string | null | undefined): ScanSensorId[] | undefined {
  if (raw == null || raw === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  return parsed.filter(isScanSensorId);
}
