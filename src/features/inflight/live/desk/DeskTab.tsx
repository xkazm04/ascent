// THE DESK, server half: read everything once (`loadDesk`), then hand the client view one plain prop.
// A server component with no hooks — so it carries no "use client" — and the only place the desk
// touches the db layer. `?view=desk`, behind the view switch as a beta (LiveViewSwitch.tsx).

import { liveViewHref, onAirHref } from "../LiveViewSwitch";
import { Desk } from "./Desk";
import { loadDesk } from "./deskLoad";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function DeskTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const data = await loadDesk(slug);
  return (
    <Desk
      data={data}
      hrefs={{ ledger: liveViewHref(sp, "ledger"), cockpit: liveViewHref(sp, "cockpit"), desk: liveViewHref(sp, "desk"), onAir: onAirHref(slug) }}
    />
  );
}
