import { describe, it, expect } from "vitest";
import { SCAN_CONCURRENCY } from "@/lib/pool";
import {
  CLAUDE_CLI_ESTIMATE_MS,
  HOSTED_ESTIMATE_MS,
  MOCK_ESTIMATE_MS,
} from "@/components/report/scanEstimate";
import { perRepoEstimateMs, scanExpectationMs, scanExpectationCopy } from "./scanExpectation";

describe("scanExpectation — per-repo estimate comes from the report's calibration, not a second number", () => {
  it("maps each mode onto the exported constant", () => {
    expect(perRepoEstimateMs("mock")).toBe(MOCK_ESTIMATE_MS);
    expect(perRepoEstimateMs("hosted")).toBe(HOSTED_ESTIMATE_MS);
    expect(perRepoEstimateMs("claude-cli")).toBe(CLAUDE_CLI_ESTIMATE_MS);
  });

  it("assumes the SLOWEST provider when the engine is unknown (the report's backstop rule)", () => {
    // Resolving the provider later may only SHORTEN the estimate — never lengthen it.
    expect(perRepoEstimateMs("unknown")).toBe(CLAUDE_CLI_ESTIMATE_MS);
    expect(perRepoEstimateMs("unknown")).toBeGreaterThanOrEqual(perRepoEstimateMs("hosted"));
  });
});

describe("scanExpectationMs — waves, not serial repos", () => {
  it("scales by ceil(repos / concurrency), so a full wave costs one repo's time", () => {
    expect(scanExpectationMs(1, "claude-cli", 4)).toBe(CLAUDE_CLI_ESTIMATE_MS);
    expect(scanExpectationMs(4, "claude-cli", 4)).toBe(CLAUDE_CLI_ESTIMATE_MS);
    // The partial fifth repo opens a second wave — a wave is as slow as its slowest member.
    expect(scanExpectationMs(5, "claude-cli", 4)).toBe(2 * CLAUDE_CLI_ESTIMATE_MS);
    expect(scanExpectationMs(8, "claude-cli", 4)).toBe(2 * CLAUDE_CLI_ESTIMATE_MS);
    expect(scanExpectationMs(9, "claude-cli", 4)).toBe(3 * CLAUDE_CLI_ESTIMATE_MS);
  });

  it("would over-state a batch 2.5x if it assumed serial scanning", () => {
    expect(scanExpectationMs(10, "hosted", 4)).toBeLessThan(10 * HOSTED_ESTIMATE_MS);
    expect(scanExpectationMs(10, "hosted", 4)).toBe(3 * HOSTED_ESTIMATE_MS);
  });

  it("defaults to the import route's real concurrency", () => {
    expect(scanExpectationMs(SCAN_CONCURRENCY, "hosted")).toBe(HOSTED_ESTIMATE_MS);
    expect(scanExpectationMs(SCAN_CONCURRENCY + 1, "hosted")).toBe(2 * HOSTED_ESTIMATE_MS);
  });

  it("is zero for an empty batch, and survives a nonsense concurrency", () => {
    expect(scanExpectationMs(0, "claude-cli", 4)).toBe(0);
    expect(scanExpectationMs(-3, "claude-cli", 4)).toBe(0);
    // 0 / NaN lanes must not divide by zero into Infinity waves — fall back to serial.
    expect(scanExpectationMs(3, "hosted", 0)).toBe(3 * HOSTED_ESTIMATE_MS);
    expect(scanExpectationMs(3, "hosted", Number.NaN)).toBe(3 * HOSTED_ESTIMATE_MS);
  });
});

describe("scanExpectationCopy — rounded the way approxScanDuration rounds", () => {
  it("states an unknown live run as a ceiling ('Up to'), never a flattering p50", () => {
    // 8 repos at concurrency 4 = 2 waves x 6 min.
    expect(scanExpectationCopy(8, "unknown", 4)).toBe("Up to about 12 minutes for 8 repositories, 4 at a time.");
  });

  it("names a mock preview as fast, and does not mention the pool when it does not apply", () => {
    expect(scanExpectationCopy(3, "mock", 4)).toBe("Usually under 2 minutes for 3 repositories.");
  });

  it("uses the hosted budget when the provider is known to be hosted", () => {
    expect(scanExpectationCopy(1, "hosted", 4)).toBe("Usually under 2 minutes for 1 repository.");
    // 10 repos = 3 waves x ~100s = 5 min.
    expect(scanExpectationCopy(10, "hosted", 4)).toBe("Usually about 5 minutes for 10 repositories, 4 at a time.");
  });

  it("uses the measured CLI median for a claude-cli run", () => {
    expect(scanExpectationCopy(1, "claude-cli", 4)).toBe("Usually about 6 minutes for 1 repository.");
  });

  it("renders nothing when there is nothing to promise", () => {
    expect(scanExpectationCopy(0, "unknown", 4)).toBeNull();
  });
});
