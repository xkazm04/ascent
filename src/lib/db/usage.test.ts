// Billing-aggregation invariants: the cost estimate must never silently bill at $0 when a rate is
// unset (the half-billing trap), and the per-day series must bucket by UTC day with a billable/free
// split on a stable axis. Pure functions — the DB client is mocked so the import never loads Prisma.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: () => false }));

import { buildDailySeries, estimateLlmCostUsd } from "./usage";

describe("estimateLlmCostUsd", () => {
  it("returns null unless BOTH per-MTok rates are set", () => {
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, undefined, "2")).toBeNull();
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "1", undefined)).toBeNull();
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "1", "")).toBeNull();
  });

  it("computes per-MTok cost across input and output", () => {
    expect(estimateLlmCostUsd(2_000_000, 1_000_000, "0.30", "2.50")).toBeCloseTo(0.6 + 2.5, 6);
  });

  it("treats an explicit 0 as a real price, not 'unset'", () => {
    expect(estimateLlmCostUsd(5_000_000, 5_000_000, "0", "0")).toBe(0);
  });

  it("rejects negative or non-numeric rates as unset", () => {
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "-1", "2")).toBeNull();
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "abc", "2")).toBeNull();
  });
});

describe("buildDailySeries", () => {
  const anchor = Date.UTC(2026, 5, 3); // 2026-06-03 UTC

  it("buckets by UTC day with a billable/free split on a stable axis", () => {
    const series = buildDailySeries(3, anchor, [
      { at: new Date(Date.UTC(2026, 5, 3, 10)), billable: true },
      { at: new Date(Date.UTC(2026, 5, 3, 23)), billable: false },
      { at: new Date(Date.UTC(2026, 5, 2, 1)), billable: true },
      { at: new Date(Date.UTC(2026, 4, 1)), billable: true }, // before the window -> dropped
    ]);
    expect(series.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(series.find((d) => d.date === "2026-06-03")).toMatchObject({ billable: 1, free: 1 });
    expect(series.find((d) => d.date === "2026-06-02")).toMatchObject({ billable: 1, free: 0 });
    expect(series.find((d) => d.date === "2026-06-01")).toMatchObject({ billable: 0, free: 0 });
  });
});
