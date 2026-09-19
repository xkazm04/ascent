// What the local remediation lane tells the usage ledger about itself.
//
// Two UAT findings and G19 meet in `recordAgentCost`, all about a figure that was WRITTEN rather
// than measured:
//   - MC-B19 (VICTOR-L1-04): the lane knows its repo but never resolved the repo's owning team, so
//     "Spend by team" on /usage read 100 % "Org-wide" for every non-scan lane.
//   - MC-B31 (VICTOR-L1-08): a `?? 0` inside the any-token-present spread turned "the CLI did not
//     report this field" into a measured zero, against the meter's own null-never-zero rule.
//   - G19: a null envelope stays unknown (`cost unknown`, never `$0.00`); a measured 0 stays 0.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MeterInput } from "@/lib/llm/meter";

const meterCalls: MeterInput[] = [];
vi.mock("@/lib/llm/meter", () => ({
  meter: (input: MeterInput) => {
    meterCalls.push(input);
  },
}));

const lanePatches: Record<string, unknown>[] = [];
const laneLogs: string[] = [];
vi.mock("@/lib/db/loop-runs", () => ({
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    lanePatches.push(patch);
    return null;
  }),
  appendLaneLog: vi.fn(async (_id: string, line: string) => {
    laneLogs.push(line);
    return null;
  }),
}));

vi.mock("@/lib/db/loop-runs-types", () => ({ LANE_COST_SOURCE: "envelope" }));

const teamForRepo = vi.fn(async (): Promise<string | null> => null);
vi.mock("@/lib/db/usage-events", () => ({
  defaultOwnerTeamForRepo: (...args: [string, string]) => teamForRepo(...args),
}));

const { recordAgentCost } = await import("./lane-cost");

const RESULT = {
  ok: true,
  model: "claude-sonnet-4-6",
  costMicros: 250_000, // micro-cents on the lane; USD micros at the meter
  turns: 4,
  durationMs: 12_100,
  sessionId: "sess_1",
};

beforeEach(() => {
  meterCalls.length = 0;
  lanePatches.length = 0;
  laneLogs.length = 0;
  teamForRepo.mockReset();
  teamForRepo.mockResolvedValue(null);
});

describe("recordAgentCost — attribution (MC-B19)", () => {
  it("stamps the repo's CODEOWNERS default-owner team on the metered call", async () => {
    teamForRepo.mockResolvedValue("@acme/platform");
    await recordAgentCost("lane_1", "acme", "acme/api", RESULT as never, {});
    expect(teamForRepo).toHaveBeenCalledWith("acme", "acme/api");
    expect(meterCalls).toHaveLength(1);
    expect(meterCalls[0]!.teamKey).toBe("@acme/platform");
    expect(meterCalls[0]!.repoFullName).toBe("acme/api");
  });

  it("a repo with no default owner is ORG-WIDE (null), not a missing value", async () => {
    await recordAgentCost("lane_1", "acme", "acme/api", RESULT as never, {});
    expect(meterCalls[0]!.teamKey).toBeNull();
  });

  it("a failed team lookup still meters the call — attribution never costs a ledger row", async () => {
    teamForRepo.mockRejectedValue(new Error("db down"));
    await recordAgentCost("lane_1", "acme", "acme/api", RESULT as never, {});
    expect(meterCalls).toHaveLength(1);
    expect(meterCalls[0]!.teamKey).toBeNull();
  });
});

describe("recordAgentCost — null is never zero (MC-B31)", () => {
  it("omits a token field the CLI did not report instead of writing 0", async () => {
    await recordAgentCost("lane_1", "acme", "acme/api", { ...RESULT, outputTokens: 900 } as never, {});
    const usage = meterCalls[0]!.usage!;
    expect(usage.outputTokens).toBe(900);
    // Reported as ABSENT, so the meter records `null` ("not reported") rather than a measured 0.
    expect(usage.inputTokens).toBeUndefined();
    expect(usage.cacheReadTokens).toBeUndefined();
  });

  it("sends no usage at all when the CLI reported no token counts", async () => {
    await recordAgentCost("lane_1", "acme", "acme/api", RESULT as never, {});
    expect(meterCalls[0]!.usage).toBeUndefined();
  });

  it("converts the lane's micro-cents to the meter's USD micros", async () => {
    await recordAgentCost("lane_1", "acme", "acme/api", RESULT as never, {});
    expect(meterCalls[0]!.costMicros).toBe(2_500);
  });
});

describe("recordAgentCost — null envelope stays unknown, measured 0 stays 0 (G19)", () => {
  it("writes costMicros null and logs 'cost unknown', never '$0.00', when the envelope carried none", async () => {
    await recordAgentCost("lane_1", "acme", "acme/api", { ...RESULT, costMicros: null } as never, {});
    expect(lanePatches[0]!.costMicros).toBeNull();
    expect(laneLogs[0]).toContain("cost unknown");
    expect(laneLogs[0]).not.toContain("$0.00");
  });

  it("writes costMicros 0 as a measurement when the CLI reported zero", async () => {
    await recordAgentCost("lane_1", "acme", "acme/api", { ...RESULT, costMicros: 0 } as never, {});
    expect(lanePatches[0]!.costMicros).toBe(0);
  });
});
