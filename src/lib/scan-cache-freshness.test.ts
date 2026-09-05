import { afterEach, describe, expect, it } from "vitest";
import { isPersistedScanFresh, scanMaxCacheAgeMs } from "./scan-cache";

const DAY = 86_400_000;
const orig = process.env.SCAN_MAX_CACHE_AGE_DAYS;

afterEach(() => {
  if (orig === undefined) delete process.env.SCAN_MAX_CACHE_AGE_DAYS;
  else process.env.SCAN_MAX_CACHE_AGE_DAYS = orig;
});

describe("scanMaxCacheAgeMs", () => {
  it("defaults to 7 days", () => {
    delete process.env.SCAN_MAX_CACHE_AGE_DAYS;
    expect(scanMaxCacheAgeMs()).toBe(7 * DAY);
  });
  it("honors the env override", () => {
    process.env.SCAN_MAX_CACHE_AGE_DAYS = "14";
    expect(scanMaxCacheAgeMs()).toBe(14 * DAY);
  });
  it("0 disables the gate", () => {
    process.env.SCAN_MAX_CACHE_AGE_DAYS = "0";
    expect(scanMaxCacheAgeMs()).toBe(0);
  });
  it("falls back to 7 days for a non-numeric value", () => {
    process.env.SCAN_MAX_CACHE_AGE_DAYS = "abc";
    expect(scanMaxCacheAgeMs()).toBe(7 * DAY);
  });
});

describe("isPersistedScanFresh", () => {
  const now = 1_000 * DAY; // fixed clock

  it("is fresh within the window", () => {
    delete process.env.SCAN_MAX_CACHE_AGE_DAYS;
    expect(isPersistedScanFresh(new Date(now - 3 * DAY).toISOString(), now)).toBe(true);
  });
  it("is stale beyond the window → re-scan", () => {
    delete process.env.SCAN_MAX_CACHE_AGE_DAYS;
    expect(isPersistedScanFresh(new Date(now - 8 * DAY).toISOString(), now)).toBe(false);
  });
  it("treats a missing/garbled timestamp as not fresh", () => {
    delete process.env.SCAN_MAX_CACHE_AGE_DAYS;
    expect(isPersistedScanFresh(undefined, now)).toBe(false);
    expect(isPersistedScanFresh("not-a-date", now)).toBe(false);
  });
  it("never ages out when the gate is disabled (0)", () => {
    process.env.SCAN_MAX_CACHE_AGE_DAYS = "0";
    expect(isPersistedScanFresh(new Date(now - 999 * DAY).toISOString(), now)).toBe(true);
    expect(isPersistedScanFresh(undefined, now)).toBe(true);
  });
});
