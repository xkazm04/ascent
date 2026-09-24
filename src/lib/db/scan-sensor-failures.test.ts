// The Scan.sensorFailuresJson decode. The typed list of GitHub sensors whose read THREW is what lets
// the gate say "read FAILED" instead of "not read" (or, worse, score a failed read as absence). It is
// only honest across the DB cache tier if the decode keeps three states apart:
//
//   NULL / unreadable column -> undefined  UNKNOWN (a legacy row, or a report that never carried it)
//   JSON []                  -> []         PROVEN: the scan ran and no sensor threw
//   JSON ["governance"]      -> [...]      the named reads failed
//
// Collapsing the first into the second is the exact lie `sensorFailed` exists to stop.

import { describe, expect, it } from "vitest";
import { parseSensorFailures } from "./scan-sensor-failures";

describe("parseSensorFailures", () => {
  it.each([null, undefined, "", "{broken", "null", "true", "42", '"governance"', '{"governance":true}'])(
    "an unread / malformed column %j is UNKNOWN (undefined), never 'no failures'",
    (raw) => {
      expect(parseSensorFailures(raw)).toBeUndefined();
    },
  );

  it("JSON [] is a PROVEN empty list (the scan ran; nothing threw)", () => {
    expect(parseSensorFailures("[]")).toEqual([]);
  });

  it("keeps the failed sensors in their stored order", () => {
    expect(parseSensorFailures('["governance","securityPosture"]')).toEqual(["governance", "securityPosture"]);
  });

  it("drops non-strings and ids that are not a known sensor (a hand-edited or renamed value cannot enter typed)", () => {
    expect(parseSensorFailures('["governance",3,null,"bogusSensor","ciHealth"]')).toEqual(["governance", "ciHealth"]);
  });

  it("accepts every sensor id the ingest phase can record", () => {
    const all = ["pullRequests", "governance", "securityPosture", "securityExposure", "appInventory", "ciHealth", "deployments"];
    expect(parseSensorFailures(JSON.stringify(all))).toEqual(all);
  });
});
