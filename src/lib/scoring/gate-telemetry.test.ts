// The load-bearing distinction in gate telemetry is `blocked` vs `pass`. Counting every !pass as a
// block would overstate the gate's bite: a degraded grade and a fork-PR default-branch fallback both
// fail for reasons that are NOT "this repository is below the bar", and both are frequent.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logGateVerdict } from "./gate-telemetry";
import type { GateResult } from "./gate";
import type { ScanReport } from "@/lib/types";

const report = () =>
  ({
    level: { id: "L2" },
    overallScore: 41,
    posture: { id: "ungoverned" },
    archetype: "org",
    engine: { provider: "mock" },
  }) as unknown as ScanReport;

const fail: GateResult = {
  pass: false,
  policy: {},
  failures: [
    { code: "dimension", message: "D2 low" },
    { code: "dimension", message: "D9 low" },
    { code: "level", message: "below L3" },
  ],
};
const pass: GateResult = { pass: true, policy: {}, failures: [] };

/** The single emitted line, parsed back out of the `[gate:verdict] {…}` envelope. */
function emitted(spy: ReturnType<typeof vi.spyOn>) {
  const line = String(spy.mock.calls.at(-1)?.[0]);
  return JSON.parse(line.slice(line.indexOf("{")));
}

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("logGateVerdict", () => {
  it("counts an authoritative failing verdict as blocked, with the deduped failing conditions", () => {
    logGateVerdict(report(), fail, { surface: "check-run", repo: "acme/api", policySource: "org" });

    const e = emitted(info);
    expect(e).toMatchObject({ surface: "check-run", repo: "acme/api", pass: false, blocked: true, authoritative: true });
    expect(e.codes).toEqual(["dimension", "level"]); // three failures, two distinct conditions
    expect(e).toMatchObject({ level: "L2", overall: 41, posture: "ungoverned", policySource: "org" });
  });

  it("does NOT count a DEGRADED verdict as a block — the grade was never produced", () => {
    logGateVerdict(report(), fail, { surface: "api", repo: "acme/api", policySource: "params", degraded: true });

    expect(emitted(info)).toMatchObject({ pass: false, blocked: false, degraded: true, authoritative: false });
  });

  it("does NOT count a fork-PR default-branch fallback as a block", () => {
    logGateVerdict(report(), fail, { surface: "check-run", repo: "acme/api", policySource: "org", scoredHead: false });

    expect(emitted(info)).toMatchObject({ pass: false, blocked: false, authoritative: false });
  });

  it("emits passes too, so a rate can be computed rather than only failures counted", () => {
    logGateVerdict(report(), pass, { surface: "api", repo: "acme/api", ref: "sha1", policySource: "archetype" });

    expect(emitted(info)).toMatchObject({ pass: true, blocked: false, codes: [], ref: "sha1" });
  });

  it("never throws — telemetry cannot break the gate it observes", () => {
    // A report whose field access itself explodes (a proxy/getter over a reconstructed row). The point
    // is that the throw happens INSIDE the payload build, which is the only way this could ever take
    // the gate down with it.
    const poisoned = {
      ...report(),
      get level(): never {
        throw new Error("boom");
      },
    } as unknown as ScanReport;

    expect(() => logGateVerdict(poisoned, fail, { surface: "api", repo: "acme/api", policySource: "org" })).not.toThrow();
    expect(info).not.toHaveBeenCalled(); // it failed before emitting, rather than emitting garbage
  });
});
