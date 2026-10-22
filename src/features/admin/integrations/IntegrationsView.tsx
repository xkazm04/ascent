"use client";

// Integrations. The open level is the URL hash; the overview and the level are never both mounted.
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { IntegrationLevel } from "./IntegrationLevel";
import { IntegrationsOverview } from "./IntegrationsOverview";
import type { IntegrationsData } from "./integrationModel";
import { useIntegrationLevel } from "./useIntegrationLevel";

export function IntegrationsView({ data }: { data: IntegrationsData }) {
  const [level, setLevel] = useIntegrationLevel();
  return (
    <div className="space-y-6">
      {level ? (
        <IntegrationLevel data={data} id={level} onOpen={setLevel} onClose={() => setLevel(null)} />
      ) : (
        <IntegrationsOverview data={data} onOpen={setLevel} />
      )}
      <NextMoveLink href={orgTabHref(data.slug, "repositories")} to="repositories" />
    </div>
  );
}
