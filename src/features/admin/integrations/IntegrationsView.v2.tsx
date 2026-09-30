"use client";

// Prism integrations. The open level is the URL hash; the overview and the level are never both mounted.
import { IntegrationLevelV2 } from "./IntegrationLevel.v2";
import { IntegrationsOverviewV2 } from "./IntegrationsOverview.v2";
import type { IntegrationsData } from "./integrationModel";
import { useIntegrationLevel } from "./useIntegrationLevel";

export function IntegrationsViewV2({ data }: { data: IntegrationsData }) {
  const [level, setLevel] = useIntegrationLevel();
  if (level) return <IntegrationLevelV2 data={data} id={level} onOpen={setLevel} onClose={() => setLevel(null)} />;
  return <IntegrationsOverviewV2 data={data} onOpen={setLevel} />;
}
