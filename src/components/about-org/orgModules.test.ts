// Drift guard for the /about-org headline counts.
//
// The masthead ledger, the page <title>/description and the FAQ payload all print "N modules /
// N views". They are derived rather than authored, and this pins the derivation to the nav catalog
// so a module or tab added to the rail cannot leave the marketing page quietly undercounting the
// product.

import { describe, it, expect } from "vitest";
import { ORG_NAV_GROUPS, ORG_TABS_NOT_IN_NAV } from "@/lib/org/orgTabs";
import { MODULE_COUNT, VIEW_COUNT, orgGroupLabelFor } from "./orgModules";
import { ABOUT_ORG_FEATURES } from "./orgFeatures";

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

// The /about-org deck prints a "you are here" module name beside every deep link (AboutOrgQuestions,
// AboutOrgLoop) and at the head of every feature pane (orgFeatures). Those names were hand-typed, and
// named modules the rail retired in the Standing/Shared/In flight/Bought/Admin regroup: "Fleet",
// "Intelligence", "Govern", "Plan", "Library". A reader who followed one of the links landed in a
// module that did not exist — on the very page that promises "same modules, same order, same names".
describe("/about-org names only the modules the rail actually has", () => {
  const RAIL_LABELS = new Set(ORG_NAV_GROUPS.map((g) => g.label));

  it("resolves every in-rail tab to its group label, and nothing to a retired name", () => {
    for (const group of ORG_NAV_GROUPS) {
      for (const item of group.items) {
        expect(orgGroupLabelFor(item.id), item.id).toBe(group.label);
      }
    }
  });

  it("gives every feature kicker a module half the rail recognises", () => {
    for (const f of ABOUT_ORG_FEATURES) {
      const moduleName = f.kicker.split(" · ")[0]!;
      expect(RAIL_LABELS.has(moduleName), `${f.id} kicker names "${moduleName}"`).toBe(true);
    }
  });

  it("returns null rather than a wrong trail for a tab that is not a rail item", () => {
    for (const id of ORG_TABS_NOT_IN_NAV) expect(orgGroupLabelFor(id), id).toBeNull();
  });
});
