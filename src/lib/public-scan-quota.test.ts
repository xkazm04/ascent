import { describe, it, expect } from "vitest";
import { decideQuota, parseHits, hashIp, publicScanWeeklyLimit } from "./public-scan-quota";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000; // fixed epoch for deterministic windows

describe("decideQuota", () => {
  it("allows the first scan from an empty window and counts it", () => {
    const d = decideQuota([], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(2);
    expect(d.hits).toEqual([NOW]);
    expect(d.resetAt).toBe(NOW + WEEK_MS);
  });

  it("allows up to the limit, then denies", () => {
    const prior = [NOW - 3000, NOW - 2000, NOW - 1000]; // 3 hits already in-window
    const d = decideQuota(prior, NOW, 3);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(d.hits).toEqual(prior); // denied → window unchanged (no new hit recorded)
  });

  it("reports zero remaining when the consumed scan exactly fills the window", () => {
    const d = decideQuota([NOW - 2000, NOW - 1000], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(0); // this was the 3rd; none left
  });

  it("drops hits older than the 7-day window before deciding", () => {
    const stale = NOW - WEEK_MS - 1; // just outside the window
    const recent = NOW - 1000;
    const d = decideQuota([stale, stale, recent], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.hits).toEqual([recent, NOW]); // stale entries pruned, new hit appended
    expect(d.remaining).toBe(1);
  });

  it("frees a slot once the oldest in-window hit ages out (resetAt when denied)", () => {
    const oldest = NOW - WEEK_MS + 5000; // ages out in 5s
    const d = decideQuota([oldest, NOW - 2000, NOW - 1000], NOW, 3);
    expect(d.allowed).toBe(false);
    expect(d.resetAt).toBe(oldest + WEEK_MS);
  });

  it("treats a hit exactly at the cutoff as expired (strict >)", () => {
    const atCutoff = NOW - WEEK_MS; // not > cutoff → excluded
    const d = decideQuota([atCutoff, atCutoff, atCutoff], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.hits).toEqual([NOW]);
  });
});

describe("parseHits", () => {
  it("returns [] for null/empty/garbage", () => {
    expect(parseHits(null)).toEqual([]);
    expect(parseHits(undefined)).toEqual([]);
    expect(parseHits("")).toEqual([]);
    expect(parseHits("not json")).toEqual([]);
    expect(parseHits("{}")).toEqual([]);
  });

  it("keeps only finite numbers", () => {
    expect(parseHits(JSON.stringify([1, 2, "x", null, 3]))).toEqual([1, 2, 3]);
  });
});

describe("hashIp", () => {
  it("is deterministic and never returns the raw IP", () => {
    const ip = "203.0.113.7";
    const h = hashIp(ip);
    expect(h).toMatch(/^[0-9a-f]{64}$/); // hex SHA-256
    expect(h).toBe(hashIp(ip)); // stable
    expect(h).not.toContain(ip);
  });

  it("maps different IPs to different hashes", () => {
    expect(hashIp("203.0.113.7")).not.toBe(hashIp("203.0.113.8"));
  });
});

describe("publicScanWeeklyLimit", () => {
  it("defaults to 3", () => {
    const prev = process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    delete process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    expect(publicScanWeeklyLimit()).toBe(3);
    if (prev !== undefined) process.env.PUBLIC_SCAN_WEEKLY_LIMIT = prev;
  });

  it("honors a positive override", () => {
    const prev = process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    process.env.PUBLIC_SCAN_WEEKLY_LIMIT = "10";
    expect(publicScanWeeklyLimit()).toBe(10);
    if (prev === undefined) delete process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    else process.env.PUBLIC_SCAN_WEEKLY_LIMIT = prev;
  });
});
