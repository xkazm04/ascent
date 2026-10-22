import { describe, expect, it } from "vitest";
import { contributorFigures } from "./contributorsFigures";
import type { ContributorInsights } from "@/lib/db";

const base = { totalContributors: 2, aiActive: 1, aiActiveShare: 50, orgAiShare: 30, soloMaintainerCount: 0, namingAllowed: false } as unknown as ContributorInsights;

describe("contributorFigures", () => {
  it("states a count, not a rate, below the naming floor", () => {
    expect(contributorFigures(base)[1]?.value).toBe("1/2");
  });
  it("states the rate above the floor and flags solo-maintainer repos as watch", () => {
    const f = contributorFigures({ ...base, namingAllowed: true, soloMaintainerCount: 3 });
    expect(f[1]?.value).toBe("50%");
    expect(f[3]?.tone).toBe("watch");
  });
});
