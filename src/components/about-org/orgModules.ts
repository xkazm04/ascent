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

import { ORG_NAV_GROUPS } from "@/lib/org/orgTabs";

/** Module groups in the org rail. */
export const MODULE_COUNT = ORG_NAV_GROUPS.length;

/** Every view across those groups. */
export const VIEW_COUNT = ORG_NAV_GROUPS.reduce((n, g) => n + g.items.length, 0);
