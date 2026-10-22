// Org dashboard "Integrations" tab. SERVER component, filename PINNED.
// Owner-only: the layout already gated org READ; this tab requires the owner role because it
// manages credentials. The check runs first, before any card is built.
//
// After the gate and the reads, IntegrationsView renders the IntegrationsData.

import { OrgEmpty } from "@/components/shared/dashboard/ui";
import { ingestToken, isIngestConfigured } from "@/lib/integrations/ingest-token";
import { getIngestTokenEpoch, getProviderIngestStatus } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { orgTabHref } from "@/lib/org/orgTabs";
import { listForgeInstallations } from "@/lib/db/forge-installations";
import { getProviderConnection } from "@/lib/db/provider-credentials";
import { getMeasuredAttribution } from "@/lib/db/integrations-attribution";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import type { IntegrationsData } from "./integrationModel";
import { IntegrationsView } from "./IntegrationsView";

export async function IntegrationsTab({ slug }: { slug: string }) {
  if (!(await hasOrgRole(slug, "owner"))) {
    return (
      <OrgEmpty
        title="Owner only"
        body="Provider integrations are managed by organization owners."
        href={orgTabHref(slug, "overview")}
        cta="← Overview"
      />
    );
  }

  // Render the token at the org's CURRENT revocation epoch, so a page loaded after a rotation shows
  // the live credential rather than the superseded one. A failed lookup falls back to epoch 0.
  const epoch = (await getIngestTokenEpoch(slug).catch(() => 0)) ?? 0;
  const statuses = (await getProviderIngestStatus(slug).catch(() => null)) ?? [];
  // Secret-free rows: ForgeInstallationRow and ProviderConnectionRow carry hasCredential only.
  const forgeInstallations = await listForgeInstallations(slug).catch(() => []);
  const openaiConnection = await getProviderConnection(slug, "openai").catch(() => null);
  // After the owner gate: which repos the measured spend landed on, against Delivery's own set.
  const measured = await getMeasuredAttribution(slug).catch(() => null);
  const gitlabConnected = forgeInstallations.some((row) => row.forge === "gitlab" && row.hasCredential);
  const encryptionConfigured = isEncryptionConfigured();
  const data: IntegrationsData = {
    slug,
    ingestToken: isIngestConfigured() ? ingestToken(slug, epoch) : "",
    ingestPath: "/api/integrations/ingest",
    statuses: statuses.map((status) => ({
      source: status.source,
      lastReceived: status.lastReceived.toISOString(),
      repos: status.repos,
      costCents: status.costCents,
      tokens: status.tokens,
      seats: status.seats,
      sessions: status.sessions,
      measured: status.measured,
      ...(status.source === "claude-code" && measured ? { attribution: { ...measured, gitlabConnected } } : {}),
    })),
    forgeInstallations,
    openai: { connection: openaiConnection, encryptionConfigured },
    encryptionConfigured,
  };
  return <IntegrationsView data={data} />;
}
