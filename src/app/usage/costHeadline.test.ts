import { describe, expect, it } from "vitest";
import { costHeadline } from "./costHeadline";

const base = { periodDays: 30, costBasis: "builtin" as const, allLanesCostUsd: 0, allLanesUnpricedCalls: 0, byLane: [] as { lane: string }[] };

describe("costHeadline", () => {
  it("prints the ALL-LANE total, not the scan lane alone (VICTOR-L1-05)", () => {
    // The live arm-B capture: scan $25.90 + local agent $89.38. The tile showed $25.90.
    const h = costHeadline({
      ...base,
      allLanesCostUsd: 115.276653,
      allLanesUnpricedCalls: 34,
      byLane: [{ lane: "scan" }, { lane: "local" }],
    });
    expect(h.value).toBe("$115.28");
    expect(h.value).not.toBe("$25.90");
    expect(h.sub).toContain("all 2 lanes");
  });

  it("keeps the floor honesty the lane rows already have — unpriced calls are disclosed, never $0", () => {
    const h = costHeadline({ ...base, allLanesCostUsd: 115.28, allLanesUnpricedCalls: 34, byLane: [{ lane: "scan" }, { lane: "local" }] });
    expect(h.sub).toContain("floor: +34 calls unpriced");
  });

  it("drops the floor qualifier when every call in the period was priced", () => {
    const h = costHeadline({ ...base, allLanesCostUsd: 10, byLane: [{ lane: "scan" }, { lane: "athena" }] });
    expect(h.sub).not.toContain("unpriced");
    expect(h.sub).toBe("last 30d · all 2 lanes · built-in rates (approx.)");
  });

  it("names the scan lane rather than claiming 'all lanes' when it is the only one", () => {
    const h = costHeadline({ ...base, allLanesCostUsd: 25.9, byLane: [{ lane: "scan" }] });
    expect(h.sub).toBe("last 30d · scan lane · built-in rates (approx.)");
  });

  it("calls an env-override figure MIXED once other lanes are in it — the override only reaches scans", () => {
    const scanOnly = costHeadline({ ...base, costBasis: "env", allLanesCostUsd: 25.9, byLane: [{ lane: "scan" }] });
    expect(scanOnly.sub).toContain("configured rates");
    const mixed = costHeadline({ ...base, costBasis: "env", allLanesCostUsd: 115.28, byLane: [{ lane: "scan" }, { lane: "local" }] });
    expect(mixed.sub).toContain("configured + built-in rates");
  });

  it("does not caption ledger money 'no rate configured' when the scan lane had no basis", () => {
    const h = costHeadline({ ...base, costBasis: null, allLanesCostUsd: 89.38, byLane: [{ lane: "local" }] });
    expect(h.value).toBe("$89.38");
    expect(h.sub).toContain("built-in rates");
  });

  it("shows the em dash with the unpriced volume when nothing could be priced", () => {
    const h = costHeadline({ ...base, costBasis: null, allLanesCostUsd: null, allLanesUnpricedCalls: 7, byLane: [{ lane: "local" }] });
    expect(h.value).toBe("—");
    expect(h.sub).toContain("7 calls unpriced");
    expect(h.sub).toContain("LLM_*_COST_PER_MTOK");
  });
});
