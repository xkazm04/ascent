// HONEST COST FOR A TRANSPORT-ARMED LANE — the fabricated price, and the pooled token record.
//
// Both figures below are the REAL measured shapes from 2026-09-21 on this machine: `claude -p`
// pointed at a local Ollama endpoint returned `total_cost_usd: 0.084` with `costBasis: "unknown"`,
// a price computed from a rate card for a model that was never called. `parseAgentEnvelope` turns
// that into `costMicros: 8_400_000` quite correctly — it is reporting what the CLI said — and this
// suite is what stops it from reaching the column real Claude spend is summed in.
//
// The sibling suite (`lane-cost.test.ts`) pins the ONE-ARM path, which is unchanged.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeterInput } from "@/lib/llm/meter";
import { MICROS_PER_USD, parseAgentEnvelope } from "@/lib/local/agent-envelope";

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
vi.mock("@/lib/db/usage-events", () => ({ defaultOwnerTeamForRepo: async () => null }));

// The profile registry as WP1/WP2 will fill it: `claude` prices its own sessions, `pi` cannot.
vi.mock("@/lib/local/transport/profile", () => ({
  transportProfile: (id: string) => ({
    id,
    label: id,
    bin: id,
    timing: { agentMs: 1, planMs: 1, quietMs: 1 },
    zeroCost: id !== "claude",
    caps: { streamJson: null, editStance: null, planStance: null, resume: null, promptOnStdin: null },
  }),
}));

const { LANE_COST_SOURCE_NONE, laneArmPatch, recordArmCost, splitLaneTokens, stepIsLocal } = await import("./lane-cost");

/** THE MEASURED ENVELOPE. `costBasis: "unknown"` is carried verbatim so the shape stays the real one. */
const LOCAL_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  total_cost_usd: 0.084,
  costBasis: "unknown",
  num_turns: 9,
  duration_ms: 812_000,
  session_id: "0b8b0a1e-1111-4222-8333-444455556666",
  usage: { input_tokens: 41_000, output_tokens: 3_100 },
});

const localResult = () => parseAgentEnvelope(LOCAL_ENVELOPE, { fallbackModel: "qwen3:27b", exitCode: 0, stderr: "" });

const claudeResult = () =>
  parseAgentEnvelope(
    JSON.stringify({
      is_error: false,
      result: "plan",
      total_cost_usd: 0.25,
      num_turns: 3,
      duration_ms: 40_000,
      model: "claude-sonnet-4-6",
      session_id: "aaaabbbb-1111-4222-8333-444455556666",
      usage: { input_tokens: 12_000, output_tokens: 900, cache_read_input_tokens: 5_000 },
    }),
    { fallbackModel: "sonnet", exitCode: 0, stderr: "" },
  );

const ENDPOINT = { model: "qwen3:27b" };

const splitArm = () => [
  { step: "plan" as const, transport: "claude" as const, model: "sonnet", result: claudeResult() },
  { step: "execute" as const, transport: "claude" as const, model: "qwen3:27b", endpoint: ENDPOINT, result: localResult() },
];

beforeEach(() => {
  meterCalls.length = 0;
  lanePatches.length = 0;
  laneLogs.length = 0;
});

describe("the fabricated price never reaches costMicros (acceptance #4)", () => {
  it("the envelope really does report 0.084 USD — the parser is not the problem", () => {
    // Pinned so the test fails loudly if the shape this whole design answers to ever changes.
    expect(localResult().costMicros).toBe(Math.round(0.084 * MICROS_PER_USD));
  });

  it("an all-local lane writes costSource 'none' and costMicros NULL — never 0", async () => {
    await recordArmCost("lane_1", "acme", "acme/api", [
      { step: "execute", transport: "pi", model: "qwen3:27b", endpoint: ENDPOINT, result: localResult() },
    ]);
    expect(lanePatches[0]!.costSource).toBe(LANE_COST_SOURCE_NONE);
    expect(lanePatches[0]!.costSource).toBe("none");
    expect(lanePatches[0]!.costMicros).toBeNull();
    expect(lanePatches[0]!.costMicros).not.toBe(0);
  });

  it("tokens, turns and duration are still recorded — only the dollars are discarded", async () => {
    await recordArmCost("lane_1", "acme", "acme/api", [
      { step: "execute", transport: "pi", model: "qwen3:27b", endpoint: ENDPOINT, result: localResult() },
    ]);
    expect(lanePatches[0]!.inputTokens).toBe(41_000);
    expect(lanePatches[0]!.outputTokens).toBe(3_100);
    expect(lanePatches[0]!.turns).toBe(9);
    expect(lanePatches[0]!.agentDurationMs).toBe(812_000);
  });

  it("the meter is handed an EXPLICIT null, so it cannot re-price the tokens from a rate card", async () => {
    await recordArmCost("lane_1", "acme", "acme/api", [
      { step: "execute", transport: "pi", model: "qwen3:27b", endpoint: ENDPOINT, result: localResult() },
    ]);
    expect(meterCalls).toHaveLength(1);
    expect(meterCalls[0]!.provider).toBe("local");
    expect("costMicros" in meterCalls[0]!).toBe(true);
    expect(meterCalls[0]!.costMicros).toBeNull();
  });

  it("`claude` pointed at a LOCAL endpoint is local too — the transport id alone is not the witness", () => {
    expect(stepIsLocal({ step: "execute", transport: "claude", model: "qwen3:27b", endpoint: ENDPOINT, result: localResult() })).toBe(true);
    expect(stepIsLocal({ step: "execute", transport: "claude", model: "sonnet", result: claudeResult() })).toBe(false);
  });
});

describe("the token record is split by who spent it (acceptance #5)", () => {
  it("a split arm's Claude tokens and local tokens are separately readable", () => {
    const split = splitLaneTokens(splitArm());
    expect(split.claude).toEqual({
      inputTokens: 12_000,
      outputTokens: 900,
      cacheReadTokens: 5_000,
      turns: 3,
      durationMs: 40_000,
      costMicros: Math.round(0.25 * MICROS_PER_USD),
    });
    expect(split.local).toEqual({
      inputTokens: 41_000,
      outputTokens: 3_100,
      cacheReadTokens: null,
      turns: 9,
      durationMs: 812_000,
      costMicros: null,
    });
    // The pooled question the metric cannot be answered from: 53 000 tokens says nothing.
    expect(split.claude!.inputTokens).not.toBe(53_000);
  });

  it("a side that did not run is null, not a row of zeroes", () => {
    const only = splitLaneTokens([{ step: "execute", transport: "claude", model: "sonnet", result: claudeResult() }]);
    expect(only.local).toBeNull();
    expect(only.claude).not.toBeNull();
  });

  it("a split arm banks the PLAN's real dollars and nothing from the local executor", () => {
    const { patch } = laneArmPatch(splitArm());
    expect(patch.costSource).toBe("envelope");
    expect(patch.costMicros).toBe(Math.round(0.25 * MICROS_PER_USD));
    // The execute half's 0.084 USD is gone, not added.
    expect(patch.costMicros).not.toBe(Math.round(0.334 * MICROS_PER_USD));
  });

  it("the row's token columns keep meaning THE EXECUTING SESSION, exactly as before transports", () => {
    const { patch } = laneArmPatch(splitArm());
    expect(patch.inputTokens).toBe(41_000);
    expect(patch.model).toBe("qwen3:27b");
    expect(patch.agentSessionId).toBe("0b8b0a1e-1111-4222-8333-444455556666");
  });

  it("two unknown counts stay unknown rather than summing to 0", () => {
    const blank = parseAgentEnvelope("", { fallbackModel: "sonnet", exitCode: 1, stderr: "" });
    const split = splitLaneTokens([
      { step: "plan", transport: "claude", model: "sonnet", result: blank },
      { step: "execute", transport: "claude", model: "sonnet", result: blank },
    ]);
    expect(split.claude!.inputTokens).toBeNull();
    expect(split.claude!.costMicros).toBeNull();
  });

  it("meters the two halves as two providers, under two idempotency keys", async () => {
    await recordArmCost("lane_1", "acme", "acme/api", splitArm());
    expect(meterCalls.map((c) => c.provider)).toEqual(["claude-cli", "local"]);
    expect(meterCalls.map((c) => c.idemKey)).toEqual(["loop-lane:lane_1:plan", "loop-lane:lane_1"]);
    // USD micros at the meter, micro-cents on the lane: the two units stay different.
    expect(meterCalls[0]!.costMicros).toBe(250_000);
    expect(meterCalls[1]!.costMicros).toBeNull();
  });

  it("logs both sides, and prints 'cost unknown' for the local half rather than $0.00", async () => {
    await recordArmCost("lane_1", "acme", "acme/api", splitArm());
    expect(laneLogs[0]).toContain("Claude:");
    expect(laneLogs[0]).toContain("Local:");
    expect(laneLogs[0]).toContain("cost unknown");
    expect(laneLogs[0]).not.toContain("$0.00");
  });
});
