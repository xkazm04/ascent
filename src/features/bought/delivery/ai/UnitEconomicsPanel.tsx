// The unit-economics region's data boundary (W3a) — its own <Suspense> in DeliveryTab, because
// AgentSession + AiChange is a genuinely independent, WINDOWED read from the core panel's
// latest-scan aggregates.
//
// Degrades to nothing rather than to an error: no DB, no org, or a read failure all render an absent
// panel. A missing panel is honest; a panel showing zeroes would assert the org spent nothing.

import { getUnitEconomics } from "@/lib/db/unit-economics";
import type { ResolvedWindow } from "@/lib/window";
import { UnitEconomics } from "./UnitEconomics";

export async function UnitEconomicsPanel({ slug, period }: { slug: string; period: ResolvedWindow }) {
  const view = await getUnitEconomics(slug, { start: period.start, end: period.end }).catch(() => null);
  if (!view) return null;
  return <UnitEconomics slug={slug} view={view} periodTitle={period.title} />;
}
