import { describe, expect, it } from "vitest";
import { SURFACE_CATALOG, SURFACE_SUBJECTS } from "@/lib/org/surface-catalog";
import { subjects } from "./catalog";

describe("surface library catalog", () => {
  it("retains the full taxonomy and the fourteen implemented studies", () => {
    expect(SURFACE_SUBJECTS).toHaveLength(33);
    expect(new Set(SURFACE_SUBJECTS.map((s) => s.slug)).size).toBe(33);
    expect(subjects.filter((s) => s.interactive).map((s) => s.slug)).toEqual([
      "table",
      "feed",
      "data-viz",
      "canvas-graph",
      "diff-comparison",
      "file-browsing",
      "search",
      "async-ui-states",
      "status-vocabulary",
      "toasts-notifications",
      "motion",
      "design-tokens",
      "accessibility",
      "adaptive-fidelity-tiers",
    ]);
    for (const record of SURFACE_CATALOG) {
      expect(record.techniqueSlugs.length).toBeGreaterThan(0);
      expect(new Set(record.techniqueSlugs).size).toBe(record.techniqueSlugs.length);
    }
  });
});
