// @vitest-environment jsdom
// The Goals card must print briefingGoalStats, never an inlined leftover ETA (G12/G4).

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BriefingGoalsCard } from "./briefingCards";
import { briefingGoalStats } from "@/lib/org/briefing";

describe("BriefingGoalsCard — one composer (2-day / 14-day / attainment-only)", () => {
  it("renders briefingGoalStats and never an ungated leftover ETA", () => {
    const twoDay = {
      label: "Lift security",
      current: 51,
      target: 80,
      pct: 50,
      pctBasis: "progress" as const,
      pctLabel: "Progress since this goal was set",
      pace: "on-pace",
      etaDays: 40,
      headline: null,
      insufficiency: "Not enough history to project: 2 distinct scan days",
    };
    const fourteenDay = {
      label: "Lift security",
      current: 64,
      target: 80,
      pct: 50,
      pctBasis: "progress" as const,
      pctLabel: "Progress since this goal was set",
      pace: "tracking",
      etaDays: 16,
      headline: "On track",
      confidence: 100,
      basis: "fit over 15 scan days across 14 days",
    };
    const attainment = {
      label: "Fleet to 70",
      current: 63,
      target: 70,
      pct: 90,
      pctBasis: "attainment" as const,
      pctLabel: "Current standing vs target (set before baselines were recorded — not progress)",
      pace: "on-pace",
      etaDays: 12,
    };
    for (const g of [twoDay, fourteenDay, attainment]) {
      const { container, unmount } = render(<BriefingGoalsCard goals={[g]} emptyText="none" />);
      expect(container.textContent).toContain(briefingGoalStats(g));
      if ((container.textContent ?? "").includes(`${g.pct}%`)) expect(container.textContent).toContain(g.pctLabel);
      unmount();
    }
    expect(briefingGoalStats(twoDay)).not.toMatch(/ETA/);
    expect(briefingGoalStats(fourteenDay)).toMatch(/ETA ~/);
    expect(briefingGoalStats(attainment)).not.toMatch(/ETA/);
  });
});
