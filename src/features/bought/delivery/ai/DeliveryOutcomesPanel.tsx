// The delivery-outcomes data boundary (W4) — its own <Suspense> in DeliveryTab, alongside unit
// economics: both are windowed reads independent of the core panel's latest-scan aggregates.
//
// G4: a thrown query is not "no deployments recorded". Null stays reserved for true absence (no DB /
// no org). A rejection surfaces SectionEmpty "couldn't load"; total===0 still renders the re-scan
// card. Swallowing the throw used to vanish the panel, which looked like the fleet never deployed.

import { SectionEmpty } from "@/components/org/shared/ui";
import { getDeliveryOutcomes } from "@/lib/db/delivery-outcomes";
import type { ResolvedWindow } from "@/lib/window";
import { settle } from "../deliveryLoad";
import { DeliveryOutcomes } from "./DeliveryOutcomes";

export async function DeliveryOutcomesPanel({ slug, period }: { slug: string; period: ResolvedWindow }) {
  const [settled] = await Promise.allSettled([getDeliveryOutcomes(slug, { start: period.start, end: period.end })]);
  const { value: outcomes, failed } = settle(settled);
  if (failed) {
    if (settled.status === "rejected") console.error(`[delivery/${slug}] getDeliveryOutcomes failed:`, settled.reason);
    return <SectionEmpty>Delivery outcomes couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>;
  }
  if (!outcomes) return null;
  return <DeliveryOutcomes slug={slug} outcomes={outcomes} periodTitle={period.title} />;
}
