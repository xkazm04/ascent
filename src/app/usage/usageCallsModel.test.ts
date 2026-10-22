// The calls drill-in model: the `?calls=` filter, the links every figure opens with, and the
// per-call "why unpriced" that must come from the one pricing rule, never a second classifier.

import { describe, expect, it } from "vitest";
import {
  REASON_COPY,
  callsHref,
  groupCalls,
  groupInputs,
  parseCallsFilter,
  serializeCallsFilter,
  summarizeUnpriced,
  unpricedReason,
} from "./usageCallsModel";
import type { UsageEventRow } from "@/lib/db/usage-events";

describe("parseCallsFilter", () => {
  it("reads team, lane, repo and unpriced filters", () => {
    expect(parseCallsFilter("team:@acme/web")).toEqual({ kind: "team", teamKey: "@acme/web" });
    expect(parseCallsFilter("lane:athena")).toEqual({ kind: "lane", lane: "athena" });
    expect(parseCallsFilter("repo:acme/api")).toEqual({ kind: "repo", repoFullName: "acme/api" });
    expect(parseCallsFilter("unpriced")).toEqual({ kind: "unpriced" });
  });

  it("refuses an unknown lane or shape: no panel, never an unfiltered dump", () => {
    expect(parseCallsFilter("lane:bogus")).toBeNull();
    expect(parseCallsFilter("lane:bogus,team:@a/b")).toBeNull();
    expect(parseCallsFilter("")).toBeNull();
    expect(parseCallsFilter(undefined)).toBeNull();
    expect(parseCallsFilter("everything")).toBeNull();
  });

  it("reads a matrix cell and the org-wide bucket", () => {
    expect(parseCallsFilter("lane:local,team:@o/a")).toEqual({ kind: "cell", lane: "local", teamKey: "@o/a" });
    expect(parseCallsFilter("lane:memory,team:")).toEqual({ kind: "cell", lane: "memory", teamKey: null });
    expect(parseCallsFilter("repo:")).toEqual({ kind: "repo", repoFullName: null });
  });

  it("round-trips through serializeCallsFilter and the href", () => {
    for (const raw of ["team:@acme/web", "lane:athena", "repo:acme/api", "unpriced", "lane:local,team:"]) {
      const f = parseCallsFilter(raw)!;
      expect(serializeCallsFilter(f)).toBe(raw);
      const url = new URL(callsHref("acme", 30, f), "http://x");
      expect(url.pathname).toBe("/usage");
      expect(url.searchParams.get("org")).toBe("acme");
      expect(url.searchParams.get("days")).toBe("30");
      expect(parseCallsFilter(url.searchParams.get("calls"))).toEqual(f);
    }
  });
});

describe("unpricedReason - the pricing rule's reason, per call", () => {
  it("names each reason", () => {
    expect(unpricedReason({ byom: true })).toBe("byom");
    expect(unpricedReason({ provider: "local" })).toBe("zero-cost");
    expect(unpricedReason({ inputTokens: null, outputTokens: null })).toBe("no-usage");
    expect(unpricedReason({ model: "mystery-1", inputTokens: 120, outputTokens: 30, costMicros: null })).toBe("unknown-model");
    expect(unpricedReason({ costMicros: 1200 })).toBeNull();
  });

  it("BYOM wins over a zero-cost provider, as the rule orders it", () => {
    expect(unpricedReason({ byom: true, provider: "local", inputTokens: 5 })).toBe("byom");
  });

  it("only unknown-model carries a fix line", () => {
    expect(REASON_COPY["unknown-model"].fix).toMatch(/LLM_INPUT\/OUTPUT_COST_PER_MTOK/);
    expect(REASON_COPY["unknown-model"].fix).toMatch(/add a price/);
    expect(REASON_COPY.byom.fix).toBeNull();
    expect(REASON_COPY["zero-cost"].fix).toBeNull();
    expect(REASON_COPY["no-usage"].fix).toBeNull();
    for (const c of Object.values(REASON_COPY)) {
      expect(`${c.label} ${c.why} ${c.fix ?? ""}`).not.toContain("\u2014");
    }
  });
});

describe("summarizeUnpriced", () => {
  it("breaks a lane's unpriced count into reasons that sum to it", () => {
    const groups = [
      { provider: "anthropic", model: "claude-sonnet-4", byom: true, tokensReported: true, calls: 38 },
      { provider: "openrouter", model: "mystery-1", byom: null, tokensReported: true, calls: 7 },
    ];
    const counts = summarizeUnpriced(groups.map(groupInputs));
    expect(counts).toEqual({ byom: 38, "zero-cost": 0, "no-usage": 0, "unknown-model": 7 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(45);
  });

  it("counts a silent group as no-usage and ignores priced rows", () => {
    const counts = summarizeUnpriced([
      groupInputs({ provider: "anthropic", model: "mystery-1", byom: null, tokensReported: false, calls: 3 }),
      { costMicros: 500, model: "claude-sonnet-4" },
    ]);
    expect(counts["no-usage"]).toBe(3);
    expect(counts["unknown-model"]).toBe(0);
  });
});

describe("groupCalls", () => {
  const row = (o: Partial<UsageEventRow>): UsageEventRow => ({
    id: "e", lane: "athena", legKind: null, refId: null, repoFullName: null, teamKey: null,
    provider: "anthropic", model: "claude-sonnet-4", byom: null, inputTokens: 10, outputTokens: 5,
    costMicros: 100, status: "success", latencyMs: null, createdAt: "2026-10-01T00:00:00.000Z", ...o,
  });

  it("keeps a failed call apart from the priced list, with its cost", () => {
    const g = groupCalls([row({ id: "a" }), row({ id: "b", status: "error", costMicros: 900 }), row({ id: "c", costMicros: null })]);
    expect(g.failed.map((r) => r.id)).toEqual(["b"]);
    expect(g.priced.map((r) => r.id)).toEqual(["a"]);
    expect(g.unpriced.map((r) => r.id)).toEqual(["c"]);
  });
});
