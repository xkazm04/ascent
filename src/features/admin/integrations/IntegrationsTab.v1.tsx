// Altimeter composition, moved unchanged from IntegrationsTab. The entry calls this as a function.
import { SectionHeader } from "@/components/org/shared/ui";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { ProviderIngestStatus } from "@/lib/db";
import { ForgeInstallationCard } from "./ForgeInstallationCard";
import { IntegrationsPanel } from "./IntegrationsPanel";
import type { IntegrationsData } from "./integrationModel";

export function integrationsV1(data: IntegrationsData) {
  const statuses: ProviderIngestStatus[] = data.statuses.map((status) => ({ ...status, lastReceived: new Date(status.lastReceived) }));
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description="Connect your AI coding providers so AI delivery has a spend layer at all — until one that reports cost is connected, its money columns are empty rather than estimated."
      />
      {/* Where the CODE is read from, above where the SPEND is read from: a forge connection changes
          which repositories can be scanned at all, which is the more fundamental of the two. */}
      <ForgeInstallationCard slug={data.slug} initial={data.forgeInstallations} encryptionConfigured={data.encryptionConfigured} />
      {/* An empty token is the "not configured here" signal: the setup panel renders the operator
          instruction instead of a credential that could never verify. */}
      <IntegrationsPanel
        slug={data.slug}
        ingestToken={data.ingestToken}
        ingestPath={data.ingestPath}
        statuses={statuses}
        openai={data.openai}
      />
      <NextMoveLink href={orgTabHref(data.slug, "repositories")} to="repositories" />
    </div>
  );
}
