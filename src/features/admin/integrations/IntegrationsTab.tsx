// Org dashboard "Integrations" tab. SERVER component, filename PINNED.
// Owner-only: the layout already gated org READ; this tab requires the owner role because it
// manages credentials. The check runs first, before any card is built.
//
// THEME DUALITY: after the gate and the reads, the theme picks the composition (IntegrationsTab.v1
// Altimeter, IntegrationsViewV2 Prism). Both receive the same IntegrationsData.

import { OrgEmpty } from "@/components/org/shared/ui";
import { ingestToken, isIngestConfigured } from "@/lib/integrations/ingest-token";
import { getIngestTokenEpoch, getProviderIngestStatus } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { orgTabHref } from "@/lib/org/orgTabs";
import { listForgeInstallations } from "@/lib/db/forge-installations";
import { getProviderConnection } from "@/lib/db/provider-credentials";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { getTheme } from "@/lib/theme/server";
import type { IntegrationsData } from "./integrationModel";
import { integrationsV1 } from "./IntegrationsTab.v1";
import { IntegrationsViewV2 } from "./IntegrationsView.v2";

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
  const theme = await getTheme();
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
    })),
    forgeInstallations,
    openai: { connection: openaiConnection, encryptionConfigured },
    encryptionConfigured,
  };
  return theme === "prism" ? <IntegrationsViewV2 data={data} /> : integrationsV1(data);
}
