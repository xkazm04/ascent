// THE LEDGER, server half: read everything once (`loadLedger`), then hand the client view one plain
// prop. A server component with no hooks — so it carries no "use client" — and the only place the
// ledger touches the db layer.

import { liveViewHref } from "../LiveViewSwitch";
import { LiveNextMove } from "../LiveNextMove";
import { Ledger } from "./Ledger";
import { loadLedger } from "./ledgerLoad";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function LedgerTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const data = await loadLedger(slug);
  return (
    <div className="space-y-4">
      <Ledger data={data} ledgerHref={liveViewHref(sp, "ledger")} cockpitHref={liveViewHref(sp, "cockpit")} />
      <LiveNextMove slug={slug} />
    </div>
  );
}
