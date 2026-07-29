// Drift guard for the /about-org module map.
//
// The map is derived from ORG_NAV_GROUPS, so a RENAMED tab flows through on its own. The failure mode
// that derivation can't catch is an ADDED tab: `BLURBS` would simply not have a key for it, the map
// would render `undefined` as its description, and the page would go on looking finished while
// silently omitting (or blanking) a whole shipped view. These tests make that a red build instead.

import { describe, it, expect } from "vitest";
import { ORG_NAV_GROUPS, ORG_TAB_IDS, orgTabLabel } from "@/lib/org/orgTabs";
import { ABOUT_ORG_MODULES, DESCRIBED_TAB_IDS, MODULE_COUNT, VIEW_COUNT } from "./orgModules";

describe("/about-org module map stays in lockstep with the org nav", () => {
  it("describes EVERY tab in the tab universe (an added tab fails here, not silently on the page)", () => {
    expect([...DESCRIBED_TAB_IDS].sort()).toEqual([...ORG_TAB_IDS].sort());
  });

  it("gives every described view a non-empty blurb", () => {
    for (const mod of ABOUT_ORG_MODULES) {
      for (const view of mod.views) {
        expect(view.blurb, `${mod.label} › ${view.label} has no blurb`).toBeTruthy();
        expect(view.blurb.length).toBeGreaterThan(20);
      }
    }
  });

  it("mirrors the rail's module order and labels rather than re-declaring them", () => {
    expect(ABOUT_ORG_MODULES.map((m) => m.key)).toEqual(ORG_NAV_GROUPS.map((g) => g.key));
    expect(ABOUT_ORG_MODULES.map((m) => m.label)).toEqual(ORG_NAV_GROUPS.map((g) => g.label));
    for (const mod of ABOUT_ORG_MODULES) {
      for (const view of mod.views) {
        expect(view.label).toBe(orgTabLabel(view.id));
      }
    }
  });

  it("links every view into the demo org's real route (never a placeholder or a bare #)", () => {
    for (const view of ABOUT_ORG_MODULES.flatMap((m) => m.views)) {
      expect(view.href.startsWith("/org/"), `${view.label} → ${view.href}`).toBe(true);
    }
  });

  it("derives the headline counts the masthead prints, so copy can't contradict the map", () => {
    expect(MODULE_COUNT).toBe(ORG_NAV_GROUPS.length);
    expect(VIEW_COUNT).toBe(ORG_NAV_GROUPS.reduce((n, g) => n + g.items.length, 0));
  });
});
