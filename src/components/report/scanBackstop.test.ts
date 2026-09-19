// Pins the failover-aware runaway backstop (useReportScan's abort timer).
//
// The regression: the backstop pinned ONCE, to the first provider a progress frame named. On a deploy
// with a hosted primary and a claude-cli fallback, scan.ts fails over mid-scan and emits the new
// provider — but the timer was already fixed at the hosted ~200s ceiling, so the client aborted a
// claude-cli scan (minutes of legitimate work) with "The scan timed out" while the server kept going.

import { describe, expect, it } from "vitest";
import type { ProviderName } from "@/lib/types";
import { backstopRemainingMs, nextBackstopCeilingMs } from "./scanBackstop";
import { expectationCopy, scanClientTimeoutMs, scanEstimateMs } from "./scanEstimate";

/** Replay a provider sequence through the hook's pin loop; returns the ceiling after every frame. */
function replay(providers: ProviderName[]): number[] {
  let pinned: number | null = null;
  const armed: number[] = [];
  for (const p of providers) {
    const next = nextBackstopCeilingMs(pinned, p);
    if (next !== null) pinned = next;
    armed.push(pinned!);
  }
  return armed;
}

describe("nextBackstopCeilingMs", () => {
  it("first resolution tightens off the unresolved (slowest-provider) default", () => {
    expect(nextBackstopCeilingMs(null, "gemini")).toBe(scanClientTimeoutMs("gemini"));
    expect(scanClientTimeoutMs("gemini")).toBeLessThan(scanClientTimeoutMs(undefined));
  });

  it("hosted → claude-cli failover LENGTHENS the ceiling", () => {
    const armed = replay(["gemini", "gemini", "claude-cli", "claude-cli"]);
    expect(armed[0]).toBe(scanClientTimeoutMs("gemini"));
    expect(armed[1]).toBe(scanClientTimeoutMs("gemini")); // repeat frame: no re-arm
    expect(armed[2]).toBe(scanClientTimeoutMs("claude-cli"));
    expect(armed[2]).toBeGreaterThan(armed[1]!);
    expect(armed[3]).toBe(armed[2]); // stable once re-pinned
  });

  it("never shortens on the reverse transition (claude-cli → hosted / mock)", () => {
    const armed = replay(["claude-cli", "gemini", "mock", "bedrock"]);
    const cli = scanClientTimeoutMs("claude-cli");
    expect(armed).toEqual([cli, cli, cli, cli]);
    expect(nextBackstopCeilingMs(cli, "mock")).toBeNull(); // "leave the running timer alone"
  });

  it("is monotonically non-decreasing across any provider sequence", () => {
    const seq: ProviderName[] = ["mock", "gemini", "openai", "claude-cli", "openrouter", "mock", "bedrock"];
    const armed = replay(seq);
    for (let i = 1; i < armed.length; i++) expect(armed[i]).toBeGreaterThanOrEqual(armed[i - 1]!);
    expect(armed.at(-1)).toBe(scanClientTimeoutMs("claude-cli"));
  });

  it("re-pinning stays consistent with the loading view's provider-keyed expectation copy", () => {
    // Both the backstop and ReportClientStatus derive from the SAME sticky progress.provider, so a
    // failover that lengthens the backstop also moves the copy back to the "still working" band
    // rather than leaving a hosted-calibrated "almost there" on screen for minutes.
    const elapsed = 200_000; // past the hosted long band (~167s), well inside claude-cli's estimate
    expect(expectationCopy(elapsed, scanEstimateMs("gemini"))).toMatch(/taking longer than usual/i);
    expect(expectationCopy(elapsed, scanEstimateMs("claude-cli"))).toMatch(/usually takes a few minutes/i);
    expect(replay(["gemini", "claude-cli"]).at(-1)).toBe(scanClientTimeoutMs("claude-cli"));
  });
});

describe("backstopRemainingMs", () => {
  it("measures from scan START, so a re-pin never grants a fresh full window", () => {
    const cli = scanClientTimeoutMs("claude-cli");
    expect(backstopRemainingMs(cli, 120_000)).toBe(cli - 120_000);
  });

  it("clamps at 0 for a ceiling already exceeded (fires immediately, never schedules into the past)", () => {
    expect(backstopRemainingMs(scanClientTimeoutMs("gemini"), 10_000_000)).toBe(0);
  });
});
