"use client";

// The Overview's data region — during the v4 prototype round this is a thin switcher over the
// baseline ledger and two directional variants (OverviewLedgerSwitcher). The props contract
// (OverviewLedgerData) is unchanged and lives with the baseline body in OverviewLedgerBaseline.tsx,
// so OverviewFleetPanel keeps deriving everything once on the server and handing it over serialised.

import { OverviewLedgerSwitcher } from "./OverviewLedgerSwitcher";
import type { OverviewLedgerData } from "./OverviewLedgerBaseline";

export type { OverviewLedgerData } from "./OverviewLedgerBaseline";

export function OverviewLedger(d: OverviewLedgerData) {
  return <OverviewLedgerSwitcher {...d} />;
}
