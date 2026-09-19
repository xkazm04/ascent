// The unit-economics region's data boundary (W3a) — its own <Suspense> in DeliveryTab, because
// AgentSession + AiChange is a genuinely independent, WINDOWED read from the core panel's
// latest-scan aggregates.
//
// G4: a thrown query is not "no attempts recorded". Null stays reserved for true absence (no DB /
// no org). A rejection surfaces SectionEmpty "couldn't load"; sessions===0 still renders the
// onboarding card. Swallowing the throw used to vanish the panel, which after a connected Claude
// exporter looked like session.id never arrived.

import { SectionEmpty } from "@/components/org/shared/ui";
import { getUnitEconomics } from "@/lib/db/unit-economics";
import type { ResolvedWindow } from "@/lib/window";
import { settle } from "../deliveryLoad";
import { UnitEconomics } from "./UnitEconomics";

export async function UnitEconomicsPanel({ slug, period }: { slug: string; period: ResolvedWindow }) {
  const [settled] = await Promise.allSettled([getUnitEconomics(slug, { start: period.start, end: period.end })]);
  const { value: view, failed } = settle(settled);
  if (failed) {
    if (settled.status === "rejected") console.error(`[delivery/${slug}] getUnitEconomics failed:`, settled.reason);
    return <SectionEmpty>Unit economics couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>;
  }
  if (!view) return null;
  return <UnitEconomics slug={slug} view={view} periodTitle={period.title} />;
}
