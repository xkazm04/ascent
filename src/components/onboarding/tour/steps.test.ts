// The rail step's copy names the rail. It used to say "Four questions ... Chosen ...", a lane the rail
// retired in the Standing/Shared/In flight/Bought/Admin regroup.

import { describe, it, expect } from "vitest";
import { ORG_NAV_GROUPS } from "@/lib/org/orgTabs";
import { ORG_TOUR_STEPS } from "./steps";

describe("the modules-nav tour step", () => {
  const body = ORG_TOUR_STEPS.find((s) => s.id === "modules-nav")!.body;

  it("names every lane the rail has", () => {
    for (const g of ORG_NAV_GROUPS) expect(body, g.label).toContain(g.label);
  });

  it("does not name the retired lane or the retired count", () => {
    expect(body).not.toContain("Chosen");
    expect(body).not.toContain("Four questions");
  });
});
