// The /about-org headline counts, DERIVED from the org dashboard's real nav catalog.
//
// The point of this file is that it cannot describe a product that doesn't exist: the module and view
// figures the masthead ledger prints — and the ones the page's <title>/description and FAQ payload
// repeat — come from `ORG_NAV_GROUPS` (src/lib/org/orgTabs.ts), the same constant the shipping rail
// renders. Add a module or a tab and the copy counts it the same day; hand-copied figures would be
// selling last quarter's product within two sprints.
//
// This file used to also carry a per-view blurb table feeding a module-map section on the deck. The
// section was cut; the table went with it rather than lingering as prose nothing renders.

import { ORG_NAV_GROUPS, type OrgTabId } from "@/lib/org/orgTabs";

/** Module groups in the org rail. */
export const MODULE_COUNT = ORG_NAV_GROUPS.length;

/** Every view across those groups. */
export const VIEW_COUNT = ORG_NAV_GROUPS.reduce((n, g) => n + g.items.length, 0);

/**
 * The nav GROUP a tab lives in, by its shipping label — the "you are here" trail every /about-org
 * section prints beside a deep link.
 *
 * This exists because three sections were printing module names the product does not have. The rail's
 * groups are Standing / Shared / In flight / Bought / Admin (`ORG_NAV_GROUPS`); the marketing copy
 * hand-typed "Fleet", "Intelligence", "Govern", "Plan" and "Library" — names from an earlier
 * information architecture, still on the page after the regroup that retired them, on a page whose
 * own module map promises "same modules, same order, same names" (`AboutOrgModules.tsx:20`). A
 * derivation means the next regroup carries the copy with it instead of leaving it behind.
 *
 * Returns null for a tab outside the rail (`ORG_TABS_NOT_IN_NAV`), so a caller that wanted a trail
 * gets nothing rather than a wrong one.
 */
export function orgGroupLabelFor(id: OrgTabId): string | null {
  return ORG_NAV_GROUPS.find((g) => g.items.some((i) => i.id === id))?.label ?? null;
}
