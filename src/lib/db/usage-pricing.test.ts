// THE call-pricing rule, pinned. Every /usage fold (scan lane, per-repo, per-team, showback matrix)
// and the meter's `costMicrosFor` price a call through `priceCallGroup`, so one call can never be
// "priced at $0" in one panel and "unpriced" in the one beside it. These figures are ESTIMATES for
// display: nothing here feeds a credit, a quota, a plan gate or a charge.

import { describe, expect, it } from "vitest";
import {
  TABLE_BASIS,
  envBasis,
  estimateLlmCostFromTable,
  foldCallGroups,
  isUnpricedReason,
  priceCallGroup,
  resolveScanBasis,
  unpricedScanCalls,
} from "./usage-pricing";
import { costMicrosFor, meterCallPrice } from "@/lib/llm/meter";

const ENV = envBasis("3", "15")!;
const M = 1_000_000;

describe("resolveScanBasis - resolved ONCE per summary", () => {
  it("is the env basis only when BOTH rates parse, the table otherwise", () => {
    expect(resolveScanBasis({ LLM_INPUT_COST_PER_MTOK: "3", LLM_OUTPUT_COST_PER_MTOK: "15" })).toEqual({
      kind: "env",
      inPerMTok: 3,
      outPerMTok: 15,
    });
    expect(resolveScanBasis({ LLM_INPUT_COST_PER_MTOK: "3" })).toEqual(TABLE_BASIS);
    expect(resolveScanBasis({ LLM_INPUT_COST_PER_MTOK: "-1", LLM_OUTPUT_COST_PER_MTOK: "15" })).toEqual(TABLE_BASIS);
    expect(resolveScanBasis({})).toEqual(TABLE_BASIS);
  });

  it("treats an explicit 0 as a real rate", () => {
    expect(envBasis("0", "0")).toEqual({ kind: "env", inPerMTok: 0, outPerMTok: 0 });
  });
});

describe("priceCallGroup - one price and one reason per call group", () => {
  it("prices a zero-cost local provider at exactly $0 even under the operator's env rates", () => {
    expect(priceCallGroup({ provider: "local", model: "llama3", inputTokens: M, outputTokens: M }, ENV)).toEqual({
      usd: 0,
      reason: "zero-cost",
    });
  });

  it("never prices BYOM, under env rates or the table", () => {
    const g = { provider: "gemini", model: "gemini-3.7-flash", byom: true, inputTokens: M, outputTokens: M };
    expect(priceCallGroup(g, ENV)).toEqual({ usd: null, reason: "byom" });
    expect(priceCallGroup(g, TABLE_BASIS)).toEqual({ usd: null, reason: "byom" });
    expect(isUnpricedReason("byom")).toBe(true);
    expect(foldCallGroups([{ ...g, calls: 4 }], ENV)).toEqual({ usd: null, unpricedCalls: 4 });
  });

  it("checks BYOM before zero-cost: a BYOM local run is still the org's own spend", () => {
    expect(priceCallGroup({ provider: "local", model: "x", byom: true, inputTokens: M, outputTokens: 0 }, ENV).reason).toBe(
      "byom",
    );
  });

  it("prices an unknown model at the env rate, and refuses to guess one from the table", () => {
    const g = { provider: "openai", model: "some-unlisted-model-v9", inputTokens: M, outputTokens: M };
    expect(priceCallGroup(g, ENV)).toEqual({ usd: 18, reason: "priced" });
    expect(priceCallGroup(g, TABLE_BASIS)).toEqual({ usd: null, reason: "unknown-model" });
  });

  it("reports a token-less call as no-usage, never as a $0 spend", () => {
    const g = { provider: "gemini", model: "gemini-3.7-flash", inputTokens: 0, outputTokens: 0 };
    expect(priceCallGroup(g, ENV)).toEqual({ usd: null, reason: "no-usage" });
    expect(isUnpricedReason("no-usage")).toBe(true);
    expect(isUnpricedReason("zero-cost")).toBe(false);
  });
});

describe("foldCallGroups - the fold every panel shares", () => {
  it("counts only the calls no basis could price, and sums the rest", () => {
    const out = foldCallGroups(
      [
        { provider: "openai", model: "mystery", inputTokens: M, outputTokens: 0, calls: 2 },
        { provider: "local", model: "llama3", inputTokens: M, outputTokens: M, calls: 5 },
        { provider: "mock", model: null, inputTokens: 0, outputTokens: 0, calls: 1 },
      ],
      ENV,
    );
    expect(out.usd).toBeCloseTo(3, 10);
    expect(out.unpricedCalls).toBe(1);
  });

  it("refuses a partial figure on the table basis: one unknown model nulls the fold", () => {
    const out = foldCallGroups(
      [
        { provider: "openai", model: "gpt-4o-mini", inputTokens: M, outputTokens: M, calls: 1 },
        { provider: "openai", model: "mystery", inputTokens: M, outputTokens: 0, calls: 3 },
      ],
      TABLE_BASIS,
    );
    expect(out).toEqual({ usd: null, unpricedCalls: 3 });
  });
});

describe("the meter and the scan fold classify a call identically", () => {
  const usage = { inputTokens: M, outputTokens: M };

  it("a zero-cost provider is priced $0 with reason zero-cost on BOTH sides", () => {
    expect(meterCallPrice("local", "sonnet", usage, false)).toEqual({ usd: 0, reason: "zero-cost" });
    expect(costMicrosFor("local", "sonnet", usage, false)).toBe(0);
    const scanGroup = { provider: "local", model: "sonnet", byom: false, inputTokens: M, outputTokens: M, calls: 1 };
    expect(priceCallGroup(scanGroup, TABLE_BASIS)).toEqual({ usd: 0, reason: "zero-cost" });
    expect(estimateLlmCostFromTable([scanGroup])).toBe(0);
    expect(unpricedScanCalls([scanGroup])).toBe(0);
  });

  it("an unpriced model is unpriced on both sides", () => {
    expect(meterCallPrice("openai", "mystery", usage, false).reason).toBe("unknown-model");
    expect(priceCallGroup({ provider: "openai", model: "mystery", ...usage }, TABLE_BASIS).reason).toBe(
      "unknown-model",
    );
  });
});
