// The unit-economics region's data boundary (W3a) — its own <Suspense> in DeliveryTab, because
// AgentSession + AiChange is a genuinely independent, WINDOWED read from the core panel's
// latest-scan aggregates.
//
// G4: a thrown query is not "no attempts recorded". Null stays reserved for true absence (no DB /
// no org). A rejection surfaces SectionEmpty "couldn't load"; sessions===0 still renders the
// onboarding card. Swallowing the throw used to vanish the panel, which after a connected Claude
// exporter looked like session.id never arrived.

import { SectionEmpty } from "@/components/org/shared/ui";
import { Frame, Lede } from "@/components/kit";
import { getUnitEconomics } from "@/lib/db/unit-economics";
import type { ResolvedWindow } from "@/lib/window";
import type { ThemeId } from "@/lib/theme/theme";
import { settle } from "../deliveryLoad";
import { UnitEconomics } from "./UnitEconomics";
import { UnitEconomicsV2 } from "./UnitEconomics.v2";

const FAILED = "Unit economics couldn't load right now. Try refreshing this page.";

export async function UnitEconomicsPanel({
  slug,
  period,
  theme = "altimeter",
}: {
  slug: string;
  period: ResolvedWindow;
  theme?: ThemeId;
}) {
  const [settled] = await Promise.allSettled([getUnitEconomics(slug, { start: period.start, end: period.end })]);
  const { value: view, failed } = settle(settled);
  if (failed) {
    if (settled.status === "rejected") console.error(`[delivery/${slug}] getUnitEconomics failed:`, settled.reason);
    return theme === "prism" ? <Frame pad="sm"><Lede>{FAILED}</Lede></Frame> : <SectionEmpty>{FAILED}</SectionEmpty>;
  }
  if (!view) return null;
  return theme === "prism" ? (
    <UnitEconomicsV2 slug={slug} view={view} periodTitle={period.title} />
  ) : (
    <UnitEconomics slug={slug} view={view} periodTitle={period.title} />
  );
}
