// Compile-time pins for the tab universe's exhaustiveness. The `@ts-expect-error` lines ARE the test:
// `tsc --noEmit` fails the moment a missing key or an alias key stops being a type error, so the
// panel map and the reach table can never silently lose their completeness check.
//
// A compiled src module, NOT a *.test.ts: tsconfig excludes test files from tsc, which would make
// every directive below dead (the trap src/lib/db/wire-safe.ts records). orgTabReach.types.test.ts
// imports this so the fixture also shows up in the suite.

import type { PanelDef } from "@/components/org/shell/orgTabPanels";
import { ORG_TAB_IDS, orgTabReach, type OrgPanelTabId, type OrgTabId, type OrgTabReach } from "./orgTabs";

const def: PanelDef = { minH: "min-h-[1rem]", render: () => null };
const panelIds = ORG_TAB_IDS.filter((id): id is OrgPanelTabId => orgTabReach(id).kind === "panel");
const full = Object.fromEntries(panelIds.map((id) => [id, def])) as Record<OrgPanelTabId, PanelDef>;

// A complete map type-checks.
const complete = full satisfies Record<OrgPanelTabId, PanelDef>;

// A panel map missing one panel id is rejected.
const { overview: _dropped, ...missingOne } = full;
// @ts-expect-error - `overview` is missing: the panel map is exhaustive over OrgPanelTabId.
const missing = missingOne satisfies Record<OrgPanelTabId, PanelDef>;

// An alias id is not a panel key.
// @ts-expect-error - `followups` is an alias, never a panel.
const aliasKeyed = { ...full, followups: def } satisfies Record<OrgPanelTabId, PanelDef>;

// A reach table missing an id is rejected.
const reachAll = Object.fromEntries(ORG_TAB_IDS.map((id) => [id, orgTabReach(id)])) as Record<OrgTabId, OrgTabReach>;
const { lessons: _noReach, ...reachMissing } = reachAll;
// @ts-expect-error - `lessons` has no reach entry.
const reachShort = reachMissing satisfies Record<OrgTabId, OrgTabReach>;

/** Key counts of the fixtures, so the suite can see they were built over the real id sets. */
export const REACH_FIXTURE = {
  complete: Object.keys(complete).length,
  missingOne: Object.keys(missing).length,
  aliasKeyed: Object.keys(aliasKeyed).length,
  reachShort: Object.keys(reachShort).length,
  dropped: [_dropped, _noReach].length,
};
