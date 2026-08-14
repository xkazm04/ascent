// G7-03 — the three trigger classes that could always be computed and never fired: a goal off pace, a
// security line crossed, a spend spike. The builders are pure, so what's pinned here is the WORDING a
// human is interrupted with (a sent Slack message or email can't be hot-fixed) and, for spend, the
// arithmetic that decides whether anyone is interrupted at all.

import { afterEach, describe, expect, it } from "vitest";
import {
  buildGoalAtRiskMessage,
  buildSecurityAlertMessage,
  buildSpendAnomalyMessage,
  isSpendAnomaly,
  spendAnomalyRatio,
} from "./alerts";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("buildGoalAtRiskMessage", () => {
  const goal = {
    label: "Lift fleet security",
    metricLabel: "Avg D9 Security",
    current: 54,
    target: 70,
    targetDate: "2026-09-30",
    requiredPerWeek: 1.6,
    perWeek: 0.2,
  };

  it("names the gap AND the pace shortfall — the two numbers that make it actionable", () => {
    const msg = buildGoalAtRiskMessage({ org: "acme", url: "https://a.dev/org/acme/plan", goals: [goal] });
    expect(msg.text).toContain("1 goal off pace in acme");
    expect(msg.text).toContain("Avg D9 Security 54/70 by 2026-09-30");
    expect(msg.text).toContain("needs +1.6/wk, running at +0.2/wk");
    expect(msg.text).toContain("https://a.dev/org/acme/plan");
    expect(msg.blocks.length).toBe(3);
  });

  it("pluralizes, survives an open-ended goal with no required rate, and omits an absent link", () => {
    const msg = buildGoalAtRiskMessage({
      org: "acme",
      goals: [goal, { ...goal, label: "Coverage", targetDate: null, requiredPerWeek: null, perWeek: -0.5 }],
    });
    expect(msg.text).toContain("2 goals off pace");
    expect(msg.text).toContain("Coverage: Avg D9 Security 54/70: running at -0.5/wk");
    expect(msg.text).not.toContain("http");
    expect(msg.blocks.length).toBe(2);
  });
});

describe("buildSecurityAlertMessage", () => {
  it("reads as critical and lists the repos that crossed a line", () => {
    const msg = buildSecurityAlertMessage({
      org: "acme",
      url: "https://a.dev/org/acme/governance",
      items: [
        { repo: "acme/api", detail: "2 new critical advisories", kind: "advisory" },
        { repo: "acme/web", detail: "Branch protection gate flipped to FAIL", kind: "gate" },
      ],
    });
    expect(msg.text).toContain("🔻");
    expect(msg.text).toContain("security standing dropped in acme");
    expect(msg.text).toContain("2 repos crossed a security line");
    expect(msg.text).toContain("• acme/api: 2 new critical advisories");
    expect(msg.text).toContain("• acme/web: Branch protection gate flipped to FAIL");
  });
});

describe("isSpendAnomaly — who gets interrupted about money", () => {
  it("ignores small absolute volumes no matter the ratio (2 → 6 scans is not a budget event)", () => {
    expect(isSpendAnomaly(6, 2, 2)).toBe(false);
    expect(isSpendAnomaly(9, 1, 2)).toBe(false);
  });

  it("fires at or above the ratio once the volume is meaningful, and stays silent below it", () => {
    expect(isSpendAnomaly(40, 20, 2)).toBe(true);
    expect(isSpendAnomaly(39, 20, 2)).toBe(false);
  });

  it("treats first-ever spend on an idle org as an anomaly", () => {
    expect(isSpendAnomaly(30, 0, 2)).toBe(true);
  });

  it("is one-sided — a spend DROP is never a push", () => {
    expect(isSpendAnomaly(12, 100, 2)).toBe(false);
  });

  it("SPEND_ANOMALY_RATIO overrides the default; blank/invalid falls back to 2 (never 0)", () => {
    delete process.env.SPEND_ANOMALY_RATIO;
    expect(spendAnomalyRatio()).toBe(2);
    process.env.SPEND_ANOMALY_RATIO = "";
    expect(spendAnomalyRatio()).toBe(2);
    process.env.SPEND_ANOMALY_RATIO = "0";
    expect(spendAnomalyRatio()).toBe(2);
    process.env.SPEND_ANOMALY_RATIO = "3.5";
    expect(spendAnomalyRatio()).toBe(3.5);
  });
});

describe("buildSpendAnomalyMessage", () => {
  it("states the multiple, the baseline and the priced estimate", () => {
    const msg = buildSpendAnomalyMessage({
      org: "acme",
      url: "https://a.dev/usage?org=acme",
      periodScans: 48,
      baseline: 20,
      ratio: 2.4,
      estimatedCostUsd: 13.5,
    });
    expect(msg.text).toContain("scan spend spiked in acme");
    expect(msg.text).toContain("48 metered scans this period vs a 20 trailing average (2.4×)");
    expect(msg.text).toContain("Estimated inference cost this period: $13.50.");
  });

  it("says 'no prior activity' rather than dividing by zero, and omits an unpriceable cost line", () => {
    const msg = buildSpendAnomalyMessage({ org: "acme", periodScans: 30, baseline: 0, ratio: 0, estimatedCostUsd: null });
    expect(msg.text).toContain("30 metered scans this period, against no prior activity.");
    expect(msg.text).not.toContain("Estimated inference cost");
  });
});
