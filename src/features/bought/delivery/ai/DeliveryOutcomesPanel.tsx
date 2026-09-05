// The delivery-outcomes data boundary (W4) — its own <Suspense> in DeliveryTab, alongside unit
// economics: both are windowed reads independent of the core panel's latest-scan aggregates.
//
// Degrades to nothing rather than to an error. A missing panel is honest; a panel of zeroes would
// assert the fleet deployed nothing and never failed.

import { getDeliveryOutcomes } from "@/lib/db/delivery-outcomes";
import type { ResolvedWindow } from "@/lib/window";
import { DeliveryOutcomes } from "./DeliveryOutcomes";

export async function DeliveryOutcomesPanel({ slug, period }: { slug: string; period: ResolvedWindow }) {
  const outcomes = await getDeliveryOutcomes(slug, { start: period.start, end: period.end }).catch(() => null);
  if (!outcomes) return null;
  return <DeliveryOutcomes slug={slug} outcomes={outcomes} periodTitle={period.title} />;
}
