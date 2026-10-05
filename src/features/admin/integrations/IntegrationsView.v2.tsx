"use client";

// Prism integrations. The open level is the URL hash; the overview and the level are never both mounted.
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { IntegrationLevelV2 } from "./IntegrationLevel.v2";
import { IntegrationsOverviewV2 } from "./IntegrationsOverview.v2";
import type { IntegrationsData } from "./integrationModel";
import { useIntegrationLevel } from "./useIntegrationLevel";

export function IntegrationsViewV2({ data }: { data: IntegrationsData }) {
  const [level, setLevel] = useIntegrationLevel();
  return (
    <div className="space-y-6">
      {level ? (
        <IntegrationLevelV2 data={data} id={level} onOpen={setLevel} onClose={() => setLevel(null)} />
      ) : (
        <IntegrationsOverviewV2 data={data} onOpen={setLevel} />
      )}
      <NextMoveLink href={orgTabHref(data.slug, "repositories")} to="repositories" />
    </div>
  );
}
