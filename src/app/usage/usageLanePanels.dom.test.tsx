/** @vitest-environment jsdom */

// Spend by team prints its floor: a team row whose calls could not all be priced says how many, so a
// partial sum never reads as a total (the lane panel beside it always did this; the team panel did not).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TeamUsage } from "@/lib/db/usage-events";
import { LanePanels } from "./usageLanePanels";

const team = (o: Partial<TeamUsage>): TeamUsage => ({
  teamKey: "@o/a",
  label: "@o/a",
  calls: 2,
  estimatedCostUsd: 1,
  unpricedCalls: 0,
  ...o,
});

describe("LanePanels - Spend by team", () => {
  it("prints the unpriced count beside a partial team sum", () => {
    render(<LanePanels byLane={[]} byTeam={[team({ unpricedCalls: 1 })]} periodDays={30} />);
    const label = screen.getByText(/@o\/a/).textContent ?? "";
    expect(label).toContain("$1.00");
    expect(label).toContain("· 1 unpriced");
    expect(label).not.toContain(String.fromCharCode(0x2014));
  });

  it("prints no floor when every call on the team was priced", () => {
    render(<LanePanels byLane={[]} byTeam={[team({ teamKey: "@o/b", label: "@o/b" })]} periodDays={30} />);
    expect(screen.getByText(/@o\/b/).textContent).not.toContain("unpriced");
  });
});
