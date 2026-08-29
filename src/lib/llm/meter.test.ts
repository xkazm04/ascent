// The meter's PURE half, plus the one structural property the seam depends on: `meter()` cannot
// reject and cannot throw, whatever the sink does. A mis-wired meter that surfaced its failure would
// take down the runner it was only supposed to observe — the exact risk this module is shaped around.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LANE_LABEL,
  USAGE_LANES,
  costMicrosFor,
  isUsageLane,
  laneForLegKind,
  meter,
  setMeterSink,
  type UsageEventInput,
} from "@/lib/llm/meter";

afterEach(() => setMeterSink(null));

/** Collect what the meter posts, and hand back the recorded events. */
function capture(): UsageEventInput[] {
  const seen: UsageEventInput[] = [];
  setMeterSink(async (e) => void seen.push(e));
  return seen;
}

describe("laneForLegKind", () => {
  it("folds BOTH Athena leg kinds into one lane", () => {
    // They differ in whether a human is waiting, not in whose budget they spend.
    expect(laneForLegKind("athena_turn")).toBe("athena");
    expect(laneForLegKind("athena_cycle")).toBe("athena");
  });

  it("maps the single-surface kinds to their own lane", () => {
    expect(laneForLegKind("scan")).toBe("scan");
    expect(laneForLegKind("memory")).toBe("memory");
    expect(laneForLegKind("briefing")).toBe("briefing");
  });

  it("names every lane, and recognises only real lane ids", () => {
    for (const lane of USAGE_LANES) expect(LANE_LABEL[lane]).toBeTruthy();
    expect(isUsageLane("athena")).toBe(true);
    expect(isUsageLane("skill-tailor")).toBe(false);
    expect(isUsageLane(null)).toBe(false);
  });
});

describe("costMicrosFor — null is never 0", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it("prices a known model from the built-in table", () => {
    // sonnet: $3/MTok in + $15/MTok out over 1M each = $18 = 18_000_000 micros.
    expect(costMicrosFor("claude-cli", "sonnet", usage, false)).toBe(18_000_000);
  });

  it("returns null (NOT 0) for a BYOM call — Ascent was not billed at all", () => {
    expect(costMicrosFor("bedrock", "anthropic.claude-sonnet-4", usage, true)).toBeNull();
  });

  it("returns null (NOT 0) for a zero-cost provider — there is no per-token bill to record", () => {
    expect(costMicrosFor("local", "sonnet", usage, false)).toBeNull();
  });

  it("returns null for an unpriced model id rather than guessing a rate", () => {
    expect(costMicrosFor("openai", "some-unlisted-model-v9", usage, false)).toBeNull();
  });

  it("returns null when the provider reported no usage at all", () => {
    expect(costMicrosFor("claude-cli", "sonnet", undefined, false)).toBeNull();
    expect(costMicrosFor("claude-cli", "sonnet", {}, false)).toBeNull();
  });

  it("folds cache classes into the cost basis", () => {
    // 1M cache READS bill at ~10% of the $3 input rate = $0.30.
    expect(costMicrosFor("bedrock", "anthropic.claude-sonnet-4", { cacheReadTokens: 1_000_000 }, false)).toBe(
      300_000,
    );
  });
});

describe("meter()", () => {
  it("resolves the lane from the leg kind and derives the idempotency key from the ref", () => {
    const seen = capture();
    meter({ orgSlug: "acme", legKind: "athena_turn", provider: "gemini", model: "gemini-3.7-flash", status: "success" , refId: "scan_1" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.lane).toBe("athena");
    expect(seen[0]!.idemKey).toBe("athena:scan_1");
  });

  it("honours a caller-supplied idempotency key and cost envelope (the W2-G loop-lane contract)", () => {
    const seen = capture();
    meter({
      orgSlug: "acme",
      lane: "local",
      refId: "lane_7",
      idemKey: "loop-lane:lane_7",
      provider: "claude-cli",
      model: "sonnet",
      // The loop lane's envelope is authoritative: it supplies the cost and reports no tokens.
      costMicros: 4_200,
      status: "success",
    });
    expect(seen[0]!.idemKey).toBe("loop-lane:lane_7");
    expect(seen[0]!.costMicros).toBe(4_200);
  });

  it("writes an honest null token count — never 0 — when the provider reported nothing", () => {
    const seen = capture();
    meter({ orgSlug: "acme", legKind: "memory", provider: "claude-cli", model: "sonnet", status: "success" });
    expect(seen[0]!.inputTokens).toBeNull();
    expect(seen[0]!.outputTokens).toBeNull();
    expect(seen[0]!.costMicros).toBeNull();
  });

  it("writes nothing for an unattributable or public-funnel call", () => {
    const seen = capture();
    meter({ orgSlug: null, legKind: "scan", provider: "gemini", model: "gemini-3.7-flash", status: "success" });
    meter({ orgSlug: "public", legKind: "scan", provider: "gemini", model: "gemini-3.7-flash", status: "success" });
    expect(seen).toHaveLength(0);
  });

  it("drops an event with neither a lane nor a leg kind rather than inventing a bucket", () => {
    const seen = capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    meter({ orgSlug: "acme", provider: "gemini", model: "gemini-3.7-flash", status: "success" });
    expect(seen).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns void and does NOT reject when the sink throws or rejects", async () => {
    // An unhandled rejection escaping the meter is the failure mode this asserts against: in a
    // serverless runtime it can tear down the whole invocation, killing the surface the meter was
    // only observing. Watch for it explicitly rather than trusting the runner to notice.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      setMeterSink(() => {
        throw new Error("sink exploded");
      });
      expect(
        meter({ orgSlug: "acme", legKind: "memory", provider: "gemini", model: "gemini-3.7-flash", status: "error" }),
      ).toBeUndefined();
      setMeterSink(async () => {
        throw new Error("sink rejected");
      });
      expect(
        meter({ orgSlug: "acme", legKind: "memory", provider: "gemini", model: "gemini-3.7-flash", status: "error" }),
      ).toBeUndefined();
      // Two macrotask turns: a rejection with no handler is reported after the microtask queue drains.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
