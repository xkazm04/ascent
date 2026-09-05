import { describe, expect, it } from "vitest";
import {
  CLAUDE_CLI_ESTIMATE_MS,
  HOSTED_ESTIMATE_MS,
  MOCK_ESTIMATE_MS,
  expectationCopy,
  formatDuration,
  scanClientTimeoutMs,
  scanEstimateMs,
  timeProgressPct,
} from "./scanEstimate";

describe("scanEstimateMs — provider-aware typical wall-clock", () => {
  it("keys the estimate off the resolved provider", () => {
    expect(scanEstimateMs("claude-cli")).toBe(CLAUDE_CLI_ESTIMATE_MS);
    expect(scanEstimateMs("gemini")).toBe(HOSTED_ESTIMATE_MS);
    expect(scanEstimateMs("bedrock")).toBe(HOSTED_ESTIMATE_MS);
    expect(scanEstimateMs("openai")).toBe(HOSTED_ESTIMATE_MS);
    expect(scanEstimateMs("openrouter")).toBe(HOSTED_ESTIMATE_MS);
    expect(scanEstimateMs("mock")).toBe(MOCK_ESTIMATE_MS);
  });

  it("hosted is much faster than claude-cli, and mock is tiny", () => {
    expect(HOSTED_ESTIMATE_MS).toBeLessThan(CLAUDE_CLI_ESTIMATE_MS);
    expect(MOCK_ESTIMATE_MS).toBeLessThan(HOSTED_ESTIMATE_MS);
  });

  it("defaults an unknown/pre-first-frame provider to the SLOWEST estimate (forward-only curve)", () => {
    // Undefined must equal the max of all providers so that resolving the provider can only SHORTEN
    // the estimate — timeProgressPct then jumps forward, never backward.
    const all = [
      scanEstimateMs("claude-cli"),
      scanEstimateMs("gemini"),
      scanEstimateMs("bedrock"),
      scanEstimateMs("mock"),
    ];
    expect(scanEstimateMs(undefined)).toBe(Math.max(...all));
  });
});

describe("timeProgressPct — per-provider curve", () => {
  it("is 0 at the start and strictly increasing over time (claude-cli)", () => {
    const est = scanEstimateMs("claude-cli");
    expect(timeProgressPct(0, est)).toBe(0);
    let prev = -1;
    for (let t = 0; t <= est * 2; t += 5_000) {
      const p = timeProgressPct(t, est);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("never reaches 100 for any provider (bar completes only when the scan does)", () => {
    for (const provider of ["claude-cli", "gemini", "mock"] as const) {
      const est = scanEstimateMs(provider);
      expect(timeProgressPct(est, est)).toBeLessThan(95);
      expect(timeProgressPct(est * 100, est)).toBeLessThan(100);
    }
  });

  it("approaches ~90% near each provider's typical estimate (both curves reach HIGH territory)", () => {
    // The whole point of provider-awareness: at the typical estimate the bar is in the 85–95% band,
    // not stalled at ~24% the way a hosted scan was under the single claude-cli-tuned curve.
    for (const provider of ["claude-cli", "gemini"] as const) {
      const est = scanEstimateMs(provider);
      expect(timeProgressPct(est, est)).toBeGreaterThan(85);
    }
  });

  it("a ~90s hosted scan reaches high territory (regression guard against the old ~24% crawl)", () => {
    const hosted = scanEstimateMs("gemini"); // ~100s
    // At ~90s elapsed a hosted scan is nearly at its budget, so the bar must be well past the old
    // ~24% (what the fixed 360s estimate produced at the same elapsed time).
    expect(timeProgressPct(90_000, hosted)).toBeGreaterThan(80);
    // And under the fixed claude-cli estimate at the same 90s, the bar WAS ~24% — proving the fix.
    expect(timeProgressPct(90_000, CLAUDE_CLI_ESTIMATE_MS)).toBeLessThan(60);
  });
});

describe("formatDuration", () => {
  it("formats m:ss and clamps negatives to 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9_000)).toBe("0:09");
    expect(formatDuration(75_000)).toBe("1:15");
    expect(formatDuration(305_000)).toBe("5:05");
    expect(formatDuration(-500)).toBe("0:00");
  });
});

describe("expectationCopy — escalates relative to the provider estimate", () => {
  it("escalates honestly across the three time bands (claude-cli)", () => {
    const est = scanEstimateMs("claude-cli");
    const longMs = (est * 5) / 3;
    const early = expectationCopy(10_000, est);
    const mid = expectationCopy(est + 1, est);
    const late = expectationCopy(longMs + 1, est);
    expect(early).toMatch(/few minutes/i);
    expect(mid).toMatch(/almost there/i);
    expect(late).toMatch(/longer than usual/i);
    expect(new Set([early, mid, late]).size).toBe(3);
  });

  it("escalates on the compressed hosted timescale too (bands scale with the estimate)", () => {
    const est = scanEstimateMs("gemini");
    const longMs = (est * 5) / 3;
    expect(expectationCopy(1_000, est)).toMatch(/few minutes/i);
    expect(expectationCopy(est + 1, est)).toMatch(/almost there/i);
    expect(expectationCopy(longMs + 1, est)).toMatch(/longer than usual/i);
  });
});

describe("scanClientTimeoutMs — backstop scales with the per-provider estimate", () => {
  it("sits above each provider's long-scan band", () => {
    for (const provider of ["claude-cli", "gemini", "mock"] as const) {
      const est = scanEstimateMs(provider);
      const longMs = (est * 5) / 3;
      expect(scanClientTimeoutMs(provider)).toBeGreaterThan(longMs);
    }
  });

  it("a hosted backstop is far tighter than the claude-cli 12-min ceiling", () => {
    expect(scanClientTimeoutMs("gemini")).toBeLessThan(scanClientTimeoutMs("claude-cli"));
    // Preserve the historical claude-cli ceiling (12 min) exactly.
    expect(scanClientTimeoutMs("claude-cli")).toBe(720_000);
    // The pre-first-frame default equals the slowest (claude-cli) ceiling, so it never aborts early.
    expect(scanClientTimeoutMs(undefined)).toBe(scanClientTimeoutMs("claude-cli"));
  });
});
