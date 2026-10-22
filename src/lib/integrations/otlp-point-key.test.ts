import { describe, expect, it } from "vitest";
import { otlpPointKey } from "./otlp-point-key";
import type { OtlpDataPoint } from "./otlp-wire";

// The replay key of one OTLP delta datapoint (scan-sweep challenge 2026-10-22c, providers-0). OTLP
// carries no transmission id, so the key is the closest emitter-minted identity: series identity
// (source, metric, resource attributes, datapoint attributes) plus the delta interval. Pure; no DB.

const T0 = "1760000000000000000";
const T1 = "1760000060000000000";
const T2 = "1760000120000000000";
const res = { "git.repository": "https://github.com/acme/x.git", "session.id": "s1", "user.email": "a@acme.dev" };
const dp = (over: Partial<OtlpDataPoint> = {}): OtlpDataPoint => ({
  asDouble: 0.4,
  startTimeUnixNano: T0,
  timeUnixNano: T1,
  attributes: [
    { key: "model", value: { stringValue: "claude-x" } },
    { key: "type", value: { stringValue: "input" } },
  ],
  ...over,
});

describe("otlpPointKey", () => {
  it("is a sha256 hex digest", () => {
    expect(otlpPointKey("claude-code", res, "claude_code.cost.usage", dp())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable when resource and datapoint attributes arrive in another order", () => {
    const reordered = { "user.email": "a@acme.dev", "session.id": "s1", "git.repository": "https://github.com/acme/x.git" };
    const flipped = dp({ attributes: [...(dp().attributes ?? [])].reverse() });
    expect(otlpPointKey("claude-code", reordered, "claude_code.cost.usage", flipped)).toBe(
      otlpPointKey("claude-code", res, "claude_code.cost.usage", dp()),
    );
  });

  it("keys the interval, not the value: the same interval with another value collides", () => {
    expect(otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ asDouble: 9 }))).toBe(
      otlpPointKey("claude-code", res, "claude_code.cost.usage", dp()),
    );
  });

  it("separates consecutive intervals of one series, even at equal value", () => {
    const a = otlpPointKey("claude-code", res, "claude_code.cost.usage", dp());
    const b = otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ startTimeUnixNano: T1, timeUnixNano: T2 }));
    expect(a).not.toBe(b);
  });

  it("separates series by metric name, datapoint attributes, resource attributes and source", () => {
    const base = otlpPointKey("claude-code", res, "claude_code.cost.usage", dp());
    const variants = [
      otlpPointKey("claude-code", res, "claude_code.token.usage", dp()),
      otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ attributes: [{ key: "type", value: { stringValue: "output" } }] })),
      otlpPointKey("claude-code", { ...res, "session.id": "s2" }, "claude_code.cost.usage", dp()),
      otlpPointKey("other", res, "claude_code.cost.usage", dp()),
    ];
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it("keys a point that carries only one of the two timestamps", () => {
    expect(otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ startTimeUnixNano: undefined }))).toMatch(/^[0-9a-f]{64}$/);
    expect(otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ timeUnixNano: undefined }))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null for a datapoint with neither timestamp (admitted as unkeyed, never deduped)", () => {
    expect(otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ startTimeUnixNano: undefined, timeUnixNano: undefined }))).toBeNull();
    expect(otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ startTimeUnixNano: "0", timeUnixNano: "" }))).toBeNull();
  });

  it("treats a numeric and a string nanosecond timestamp as the same instant", () => {
    expect(otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ timeUnixNano: 1760000060000000000 }))).toBe(
      otlpPointKey("claude-code", res, "claude_code.cost.usage", dp({ timeUnixNano: "1760000060000000000" })),
    );
  });
});
