// Tenant-level facts about the deployment as a whole — not about one org.
//
// The first-run resolver (src/lib/first-run.ts) needs ONE question answered: has this install ever
// set up a tenant, or is it a fresh clone with nothing but the shared `public` corpus? The public org
// is created on demand by the first public scan and says nothing about setup, so it is excluded.

import { getPrisma, isDbConfigured, dbReadSafe } from "@/lib/db/client";
import { PUBLIC_ORG } from "@/lib/org-constants";

/** Organizations other than the shared public corpus. 0 when persistence is off or unreachable —
 *  the caller treats that as "nothing set up", which is the honest reading of both states. */
export async function countTenantOrgs(): Promise<number> {
  if (!isDbConfigured()) return 0;
  return dbReadSafe(() => getPrisma().organization.count({ where: { slug: { not: PUBLIC_ORG } } }), 0);
}
