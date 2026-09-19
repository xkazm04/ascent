// The /about ROI pane's money line sits beside RoiSimulator, whose tiles are
// promotions / avg gain / in scope. A dated "6 of 8 repos to L3 by Q3" was a
// count the demo manufactured and a calendar the sliders never show.

import { describe, it, expect } from "vitest";
import { ABOUT_FEATURES } from "./features";

describe("ABOUT_FEATURES roi.value copy contract", () => {
  const roi = ABOUT_FEATURES.find((f) => f.id === "roi");

  it("names the demo tiles and carries no dated count", () => {
    expect(roi).toBeDefined();
    const value = roi!.value;
    expect(value).toMatch(/promotions/i);
    expect(value).toMatch(/average gain|avg gain/i);
    expect(value).toMatch(/scope/i);
    expect(value).not.toMatch(/\bQ[1-4]\b/);
    expect(value).not.toMatch(/\d+\s+of\s+\d+/);
    expect(value).not.toMatch(/talk to sales/i);
    expect(value).not.toMatch(/^ROI\b/i);
  });
});
