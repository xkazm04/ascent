// The weekly run's two added pushes (G7-03). What matters here is not the copy — that's pinned in
// alerts-triggers.test.ts — but the DISPATCH DISCIPLINE: nothing fires without a trigger, each push
// takes its own at-most-once window claim, a failed delivery RELEASES that claim (so the next run
// retries instead of silently dropping the alert), and a broken data read can never fail the digest
// that carries it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  listGoals: vi.fn(async () => [] as unknown[]),
  getUsageSummary: vi.fn(async () => null as unknown),
}));

vi.mock("@/lib/db/scans-audit", () => ({
  claimOrgAuditOnce: vi.fn(async () => ({ claimed: true, id: "clm_1" })),
  releaseAuditClaim: vi.fn(async () => {}),
}));

vi.mock("@/lib/alerts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alerts")>();
  return { ...actual, dispatchAlert: vi.fn(async () => true) };
});

import { dispatchExtraAlerts, GOAL_RISK_ACTION, SPEND_ANOMALY_ACTION, splitSpendWindows } from "./extra-alerts";
import { listGoals, getUsageSummary } from "@/lib/db";
import { claimOrgAuditOnce, releaseAuditClaim } from "@/lib/db/scans-audit";
import { dispatchAlert } from "@/lib/alerts";

const mockGoals = vi.mocked(listGoals);
const mockUsage = vi.mocked(getUsageSummary);
const mockClaim = vi.mocked(claimOrgAuditOnce);
const mockRelease = vi.mocked(releaseAuditClaim);
const mockDispatch = vi.mocked(dispatchAlert);

const ctx = {
  org: "acme",
  webhookUrl: "https://hooks.example/acme",
  base: "https://ascent.test",
  windowStart: new Date("2026-07-20T00:00:00Z"),
  periodQs: "range=custom&from=2026-07-20&to=2026-07-27",
};

const behind = {
  label: "Lift security",
  metricLabel: "Avg D9",
  current: 50,
  target: 70,
  targetDate: "2026-09-01",
  requiredPerWeek: 2,
  perWeek: 0.1,
  pace: "behind",
  achieved: false,
};

const days = (n: number, billable: number) => Array.from({ length: n }, () => ({ date: "d", billable, free: 0 }));

beforeEach(() => {
  vi.clearAllMocks();
  mockGoals.mockResolvedValue([] as never);
  mockUsage.mockResolvedValue(null as never);
  mockClaim.mockResolvedValue({ claimed: true, id: "clm_1" } as never);
  mockDispatch.mockResolvedValue(true);
});

describe("nothing fires without a trigger", () => {
  it("no goals behind and no usage data → no claim, no dispatch", async () => {
    const res = await dispatchExtraAlerts(ctx);
    expect(res).toEqual({ goalAlerts: 0, spendAlerts: 0, errors: [] });
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("goals that are ON pace (or already achieved) are not 'at risk'", async () => {
    mockGoals.mockResolvedValue([
      { ...behind, pace: "on-pace" },
      { ...behind, pace: "behind", achieved: true },
      { ...behind, pace: "reached" },
    ] as never);
    const res = await dispatchExtraAlerts(ctx);
    expect(res.goalAlerts).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("steady spend is not an anomaly", async () => {
    mockUsage.mockResolvedValue({ daily: days(28, 3), estimatedCostUsd: 1 } as never);
    const res = await dispatchExtraAlerts(ctx);
    expect(res.spendAlerts).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("a real trigger fires exactly once, through the org's own sink", () => {
  it("a behind goal claims its own window key and dispatches to the org sink", async () => {
    mockGoals.mockResolvedValue([behind] as never);
    const res = await dispatchExtraAlerts(ctx);
    expect(res.goalAlerts).toBe(1);
    expect(mockClaim).toHaveBeenCalledWith(GOAL_RISK_ACTION, "acme", ctx.windowStart, expect.objectContaining({ goals: 1 }));
    const [, opts] = mockDispatch.mock.calls[0] as [unknown, { webhookUrl: string; org: string }];
    expect(opts).toEqual({ webhookUrl: "https://hooks.example/acme", org: "acme" });
  });

  it("a spend spike (this week vs the prior 3 weeks) fires under its own key", async () => {
    // 21 baseline days at 2/day (= 14 per 7-day period), then 7 days at 8/day (= 56).
    mockUsage.mockResolvedValue({ daily: [...days(21, 2), ...days(7, 8)], estimatedCostUsd: 9.25 } as never);
    const res = await dispatchExtraAlerts(ctx);
    expect(res.spendAlerts).toBe(1);
    expect(mockClaim).toHaveBeenCalledWith(SPEND_ANOMALY_ACTION, "acme", ctx.windowStart, expect.objectContaining({ periodScans: 56 }));
  });

  it("losing the window claim (a concurrent/retried run) dispatches nothing", async () => {
    mockGoals.mockResolvedValue([behind] as never);
    mockClaim.mockResolvedValue({ claimed: false, id: null } as never);
    const res = await dispatchExtraAlerts(ctx);
    expect(res.goalAlerts).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("a FAILED delivery releases the claim so the next run retries", async () => {
    mockGoals.mockResolvedValue([behind] as never);
    mockDispatch.mockResolvedValue(false);
    const res = await dispatchExtraAlerts(ctx);
    expect(res.goalAlerts).toBe(0);
    expect(mockRelease).toHaveBeenCalledWith("clm_1");
  });
});

describe("it can never break the digest that carries it", () => {
  it("a throwing read is caught, reported in errors, and does not stop the other trigger", async () => {
    mockGoals.mockRejectedValue(new Error("goal read exploded"));
    mockUsage.mockResolvedValue({ daily: [...days(21, 2), ...days(7, 8)], estimatedCostUsd: null } as never);
    const res = await dispatchExtraAlerts(ctx);
    expect(res.errors).toEqual(["acme: goal-at-risk goal read exploded"]);
    expect(res.spendAlerts).toBe(1);
  });
});

describe("splitSpendWindows", () => {
  it("splits the trailing series into this period and a per-period baseline", () => {
    expect(splitSpendWindows([...days(21, 2), ...days(7, 8)])).toEqual({ period: 56, baselinePerPeriod: 14 });
  });

  it("reports a zero baseline when there is no prior history", () => {
    expect(splitSpendWindows(days(7, 5))).toEqual({ period: 35, baselinePerPeriod: 0 });
  });
});
