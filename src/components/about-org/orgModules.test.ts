// Drift guard for the /about-org headline counts.
//
// The masthead ledger, the page <title>/description and the FAQ payload all print "N modules /
// N views". They are derived rather than authored, and this pins the derivation to the nav catalog
// so a module or tab added to the rail cannot leave the marketing page quietly undercounting the
// product.

import { describe, it, expect } from "vitest";
import { ORG_NAV_GROUPS } from "@/lib/org/orgTabs";
import { MODULE_COUNT, VIEW_COUNT } from "./orgModules";

describe("/about-org headline counts stay in lockstep with the org nav", () => {
  it("counts the rail's module groups", () => {
    expect(MODULE_COUNT).toBe(ORG_NAV_GROUPS.length);
    expect(MODULE_COUNT).toBeGreaterThan(0);
  });

  it("counts every view across those groups", () => {
    expect(VIEW_COUNT).toBe(ORG_NAV_GROUPS.reduce((n, g) => n + g.items.length, 0));
    expect(VIEW_COUNT).toBeGreaterThan(MODULE_COUNT);
  });
});
