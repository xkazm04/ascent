// The GOD-SCAN TREND metric on the operator KPI pull.
//
// `classifyOutputBudget` (src/lib/llm/output-budget.ts) warns about ONE scan. This answers the
// question that actually triggers a design change: are scans TRENDING toward the model's output
// ceiling? When they are, the fix is to split the single-call assessment into per-dimension calls,
// not to buy a bigger model — and that decision needs a fleet-wide trend, not one loud scan.
//
// Only `scanOutputBudget` is covered here; the other kpi-metrics readers predate this file.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import { scanOutputBudget } from "./kpi-metrics";

const scan = (outputTokens: number, engineModel = "claude-opus-5") => ({ engineModel, outputTokens });

function withScans(rows: { engineModel: string; outputTokens: number }[]) {
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue({ scan: { findMany: vi.fn(async () => rows) } });
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
});

describe("scanOutputBudget", () => {
  it("returns null with no database", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await scanOutputBudget()).toBeNull();
  });

  // "Not measured" and "comfortably small" are different statements. A mock-only or keyless
  // deployment reports no usage at all, and must not read as a healthy trend.
  it("returns null when no scan in the window reported usage", async () => {
    withScans([]);
    expect(await scanOutputBudget()).toBeNull();
  });

  it("reports median and p95 output tokens", async () => {
    withScans([scan(1000), scan(2000), scan(3000), scan(4000), scan(12000)]);
    const m = (await scanOutputBudget())!;
    expect(m.scans).toBe(5);
    expect(m.medianOutputTokens).toBe(3000);
    expect(m.p95OutputTokens).toBe(12000);
  });

  // p95, NOT the mean. The mean is dominated by small repos and stays reassuring long after the
  // largest repos have started truncating — and the scans that hit the ceiling ARE the tail.
  it("stays ok while only the tail is large, and escalates once the tail nears the cap", async () => {
    withScans([scan(1000), scan(1000), scan(1000), scan(12000)]);
    expect((await scanOutputBudget())!.level).toBe("ok"); // 12k of 64k = 19%

    withScans([scan(1000), scan(1000), scan(1000), scan(60000)]);
    expect((await scanOutputBudget())!.level).toBe("at-risk"); // 60k of 64k = 94%
  });

  // Mixed-engine fleets must stay comparable: the same token count is comfortable on a 64k model and
  // fatal on an 8k one, so the percentile is taken over each scan's SHARE of its own ceiling.
  it("compares against each scan's own model ceiling, not one absolute number", async () => {
    withScans([scan(7000, "claude-opus-5"), scan(7000, "haiku")]);
    const m = (await scanOutputBudget())!;
    expect(m.worst?.model).toBe("haiku"); // 7000/8192 = 85%, vs 11% on opus
    expect(m.level).toBe("at-risk");
  });

  it("names the single worst scan so an operator can go and look at it", async () => {
    withScans([scan(1000), scan(58000)]);
    expect((await scanOutputBudget())!.worst).toMatchObject({ model: "claude-opus-5", outputTokens: 58000 });
  });

  // The real measurement, pinned as a regression anchor: a live claude-opus-5 assessment of
  // vercel/sandbox on 2026-08-14 emitted 11,908 output tokens against a 64,000 ceiling. If a future
  // rubric change pushes a comparable scan past the approaching band, this is the shape that moves.
  it("grades the measured live-Opus-5 baseline as comfortable", async () => {
    withScans([scan(11908, "claude-opus-5")]);
    const m = (await scanOutputBudget())!;
    expect(m.p95PctOfCap).toBe(19);
    expect(m.level).toBe("ok");
  });
});
