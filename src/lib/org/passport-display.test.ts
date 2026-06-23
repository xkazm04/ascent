// Pure tests for the passport display helpers (P2/P3): band label/color lookups (with safe fallbacks)
// and the bounded named-stack chip summary the card + fleet table share.

import { describe, it, expect } from "vitest";
import { bandLabel, bandColor, passportStackChips, BAND_COLOR } from "@/lib/org/passport-display";
import type { AppPassport } from "@/lib/types";

describe("band label/color", () => {
  it("maps known bands", () => {
    expect(bandLabel("beta")).toBe("Beta");
    expect(bandColor("production")).toBe(BAND_COLOR.production);
  });
  it("falls back safely for an unknown band", () => {
    expect(bandLabel("weird")).toBe("weird");
    expect(bandColor("weird")).toBe("#94a3b8");
  });
});

describe("passportStackChips", () => {
  const pp = {
    stack: {
      frameworks: ["Next.js", "React"],
      persistence: [{ kind: "relational", engine: "postgresql" }, { kind: "cache", engine: "redis" }],
      integrations: [{ name: "AWS Bedrock", kind: "llm" }, { name: "Stripe", kind: "payments" }],
      languages: [],
      monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null, uptime: null },
      hosting: null,
    },
  } as unknown as AppPassport;

  it("combines frameworks + persistence engines + integration vendors, deduped + bounded", () => {
    const chips = passportStackChips(pp, 8);
    expect(chips).toEqual(expect.arrayContaining(["Next.js", "React", "postgresql", "redis", "AWS Bedrock", "Stripe"]));
    expect(chips.length).toBeLessThanOrEqual(8);
  });

  it("respects the max", () => {
    expect(passportStackChips(pp, 2)).toHaveLength(2);
  });
});
