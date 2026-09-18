// THE LEDGER, server half: read everything once (`loadLedger`), then hand the client view one plain
// prop. A server component with no hooks — so it carries no "use client" — and the only place the
// ledger touches the db layer.

import { liveViewHref } from "../LiveViewSwitch";
import { Ledger } from "./Ledger";
import { loadLedger } from "./ledgerLoad";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function LedgerTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const data = await loadLedger(slug);
  return <Ledger data={data} ledgerHref={liveViewHref(sp, "ledger")} cockpitHref={liveViewHref(sp, "cockpit")} />;
}
