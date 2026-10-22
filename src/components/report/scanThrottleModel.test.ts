// The throttle model: which 429s are a per-minute limiter refusal (and so a countdown that resumes),
// and the bounded schedule that resumes them. Pure, so every case runs on an injected clock + rng.

import { describe, it, expect } from "vitest";
import {
  FALLBACK_RETRY_SEC,
  MAX_AUTO_RESUMES,
  parseThrottle,
  secondsLeft,
  throttleCopy,
  throttleStep,
  THROTTLED_MESSAGE,
  type Throttle,
} from "./scanThrottleModel";

const now = 1_800_000_000_000;

describe("parseThrottle - the limiter's 429 body, read as a Throttle", () => {
  it("a per-IP refusal keeps its scope, limiter, stated cap and honest retry-after", () => {
    const body = { code: "rate_limited", scope: "ip", limiter: "scan", limit: 20, windowSec: 60, retryAfterSec: 34 };
    expect(parseThrottle(429, body, "34", now)).toEqual({
      scope: "ip",
      limiter: "scan",
      retryAt: now + 34_000,
      limit: 20,
      windowSec: 60,
    });
  });

  it("a global refusal says so, without a cap (the ceiling is withheld server-side)", () => {
    const body = { code: "rate_limited", scope: "global", limiter: "scan", retryAfterSec: 20 };
    expect(parseThrottle(429, body, null, now)).toEqual({ scope: "global", limiter: "scan", retryAt: now + 20_000 });
  });

  it("an unreachable limiter is its own scope", () => {
    const t = parseThrottle(429, { code: "rate_limit_unavailable", scope: "unavailable", retryAfterSec: 3 }, null, now);
    expect(t).toMatchObject({ scope: "unavailable", retryAt: now + 3000 });
  });

  it("a legacy or unreadable body falls back to the retry-after header, scope unknown", () => {
    expect(parseThrottle(429, null, "12", now)).toEqual({ scope: "unknown", retryAt: now + 12_000 });
    expect(parseThrottle(429, { code: "rate_limited", error: "slow down" }, "5", now)).toEqual({
      scope: "unknown",
      retryAt: now + 5000,
    });
  });

  it("no hint at all waits a full window rather than guessing short; an HTTP-date header reads as absent", () => {
    expect(parseThrottle(429, null, null, now)?.retryAt).toBe(now + FALLBACK_RETRY_SEC * 1000);
    expect(parseThrottle(429, null, "Wed, 21 Oct 2026 07:28:00 GMT", now)?.retryAt).toBe(
      now + FALLBACK_RETRY_SEC * 1000,
    );
  });

  it("the monthly quota, the credit gate and the sign-in wall are NOT a throttle (their paths are untouched)", () => {
    expect(parseThrottle(429, { code: "monthly_quota", scope: "anon", resetAt: now + 1e9 }, "3600", now)).toBeNull();
    expect(parseThrottle(402, { code: "INSUFFICIENT_CREDITS", balance: 0 }, null, now)).toBeNull();
    expect(parseThrottle(401, { code: "auth_required" }, null, now)).toBeNull();
    expect(parseThrottle(500, null, "5", now)).toBeNull();
    expect(parseThrottle(429, { code: "something_else" }, "5", now)).toBeNull();
  });
});

const t: Throttle = { scope: "ip", retryAt: now + 5000 };

describe("throttleStep - the bounded resume schedule", () => {
  it("waits out retry-after plus a jitter drawn from the injected rng", () => {
    expect(throttleStep(t, now, 0, true, () => 0.5)).toEqual({ kind: "wait", ms: 5000 + 1000 });
    expect(throttleStep(t, now, 0, true, () => 0)).toEqual({ kind: "wait", ms: 5000 });
    const top = throttleStep(t, now, 0, true, () => 1);
    expect(top.kind === "wait" && top.ms >= 5000 && top.ms < 7000).toBe(true);
  });

  it("resumes once the window has drained", () => {
    expect(throttleStep(t, t.retryAt, 1, true)).toEqual({ kind: "resume" });
  });

  it("after MAX_AUTO_RESUMES automatic resumes, the visitor resumes by hand", () => {
    expect(MAX_AUTO_RESUMES).toBe(2);
    expect(throttleStep(t, t.retryAt + 1, 2, true)).toEqual({ kind: "manual" });
  });

  it("a hidden tab never auto-resumes", () => {
    expect(throttleStep(t, t.retryAt + 1, 0, false)).toEqual({ kind: "paused" });
    expect(throttleStep(t, now, 0, false)).toEqual({ kind: "paused" });
  });
});

describe("countdown + copy", () => {
  it("secondsLeft rounds up and never goes negative", () => {
    expect(secondsLeft(t, now)).toBe(5);
    expect(secondsLeft(t, now + 4001)).toBe(1);
    expect(secondsLeft(t, now + 9000)).toBe(0);
  });

  it("each scope gets its own copy, and none carries an em dash", () => {
    const ip = throttleCopy({ scope: "ip", retryAt: 0, limit: 20, windowSec: 60 });
    expect(ip.body).toContain("20 scans per 60s");
    expect(throttleCopy({ scope: "global", retryAt: 0 }).body).toMatch(/not your traffic/i);
    expect(throttleCopy({ scope: "unavailable", retryAt: 0 }).body).toMatch(/nothing was counted/i);
    for (const scope of ["ip", "global", "unavailable", "unknown"] as const) {
      const c = throttleCopy({ scope, retryAt: 0 });
      expect(c.title + c.body).not.toContain("—");
    }
    expect(THROTTLED_MESSAGE).not.toContain("—");
  });
});
