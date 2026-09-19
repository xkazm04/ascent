// THE RUN'S DIALS — that every normalizer REFUSES rather than guesses, and that every default is
// today's value.
//
// The second half is the one that matters most: the whole promise of this change is that an operator
// who touches nothing arms exactly the run they would have armed before the dials existed. A default
// that drifted would make every comparison in the ledger a comparison of two different loops.

import { describe, expect, it } from "vitest";
import {
  AGENT_TIMEOUT_CAP_MS,
  AGENT_TIMEOUT_DEFAULT_MS,
  AGENT_TIMEOUT_MIN_MS,
  BATCH_SIZE_CAP,
  BATCH_SIZE_DEFAULT,
  VERIFY_TIMEOUT_CAP_MS,
  VERIFY_TIMEOUT_DEFAULT_MS,
  VERIFY_TIMEOUT_MIN_MS,
  batchSizeOf,
  normalizeAgentTimeoutMs,
  normalizeBatchSize,
  normalizeVerifyMode,
  normalizeVerifyTimeoutMs,
  verifyModeOf,
  verifyTimeoutMsOf,
} from "@/lib/local/run-limits";

describe("the defaults are today's values", () => {
  it("keeps the batch at the five the loop had hard-coded", () => {
    expect(BATCH_SIZE_DEFAULT).toBe(5);
    expect(batchSizeOf(null)).toBe(5);
    expect(batchSizeOf(undefined)).toBe(5);
  });

  it("keeps the session ceiling at ASCENT_AUTOPILOT_TIMEOUT_MS's own default of 20 minutes", () => {
    expect(AGENT_TIMEOUT_DEFAULT_MS).toBe(20 * 60_000);
  });

  it("defaults the degradation guard ON — a null column is `on`, not `off`", () => {
    // The direction is load-bearing. A run armed before the column existed reads null, and reading
    // that as "off" would silently disarm the guard on exactly the rows a reader trusts most.
    expect(verifyModeOf(null)).toBe("on");
    expect(verifyModeOf(undefined)).toBe("on");
    expect(verifyTimeoutMsOf(null)).toBe(VERIFY_TIMEOUT_DEFAULT_MS);
  });
});

describe("normalizeBatchSize never guesses", () => {
  it("accepts whole numbers inside the band", () => {
    expect(normalizeBatchSize(1)).toBe(1);
    expect(normalizeBatchSize(5)).toBe(5);
    expect(normalizeBatchSize(BATCH_SIZE_CAP)).toBe(BATCH_SIZE_CAP);
  });

  it("REFUSES rather than clamps anything past the cap", () => {
    // The distinction the header of run-limits.ts argues for: a request for 40 is a request the
    // caller got wrong, and quietly running 12 is a run nobody asked for.
    expect(normalizeBatchSize(BATCH_SIZE_CAP + 1)).toBeNull();
    expect(normalizeBatchSize(40)).toBeNull();
    expect(normalizeBatchSize(0)).toBeNull();
    expect(normalizeBatchSize(-3)).toBeNull();
  });

  it("refuses everything that is not a whole number", () => {
    for (const v of ["5", 5.5, NaN, Infinity, true, null, undefined, {}, [5]]) {
      expect(normalizeBatchSize(v), `accepted ${JSON.stringify(v)}`).toBeNull();
    }
  });
});

describe("normalizeAgentTimeoutMs never guesses", () => {
  it("accepts the band, including both ends", () => {
    expect(normalizeAgentTimeoutMs(AGENT_TIMEOUT_MIN_MS)).toBe(AGENT_TIMEOUT_MIN_MS);
    expect(normalizeAgentTimeoutMs(AGENT_TIMEOUT_CAP_MS)).toBe(AGENT_TIMEOUT_CAP_MS);
    expect(normalizeAgentTimeoutMs(45 * 60_000)).toBe(45 * 60_000);
  });

  it("refuses zero — 'no timeout' is a misconfiguration, never an instruction", () => {
    expect(normalizeAgentTimeoutMs(0)).toBeNull();
  });

  it("refuses anything past the ceiling, because the timeout is what ends a wedged session", () => {
    expect(normalizeAgentTimeoutMs(AGENT_TIMEOUT_CAP_MS + 1)).toBeNull();
    expect(normalizeAgentTimeoutMs(24 * 60 * 60_000)).toBeNull();
  });

  it("refuses non-integers and non-numbers", () => {
    for (const v of ["1200000", 1.5, NaN, null, undefined]) {
      expect(normalizeAgentTimeoutMs(v), `accepted ${JSON.stringify(v)}`).toBeNull();
    }
  });
});

describe("normalizeVerifyMode / normalizeVerifyTimeoutMs never guess", () => {
  it("accepts only the two modes", () => {
    expect(normalizeVerifyMode("on")).toBe("on");
    expect(normalizeVerifyMode("off")).toBe("off");
    for (const v of ["ON", "disabled", "true", 1, null, undefined]) {
      expect(normalizeVerifyMode(v), `accepted ${JSON.stringify(v)}`).toBeNull();
    }
  });

  it("bounds the verification budget on both sides", () => {
    expect(normalizeVerifyTimeoutMs(VERIFY_TIMEOUT_MIN_MS)).toBe(VERIFY_TIMEOUT_MIN_MS);
    expect(normalizeVerifyTimeoutMs(VERIFY_TIMEOUT_CAP_MS)).toBe(VERIFY_TIMEOUT_CAP_MS);
    expect(normalizeVerifyTimeoutMs(VERIFY_TIMEOUT_MIN_MS - 1)).toBeNull();
    expect(normalizeVerifyTimeoutMs(VERIFY_TIMEOUT_CAP_MS + 1)).toBeNull();
  });
});
