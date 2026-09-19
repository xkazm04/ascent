// Org dashboard "Integrations" tab — connect AI coding providers so the /delivery "AI delivery
// intelligence" views have a spend layer at all. (W3c retired the simulated tier: with nothing
// connected the money columns are EMPTY, not placeholder dollars.) SERVER component,
// filename PINNED (docs/ORG-TABS-REFACTOR.md; see AuditTab.tsx for the worked example).
//
// Owner-only: the layout already gated org READ; this tab additionally requires the owner role since
// it manages credentials. That check runs here (not duplicated from the layout's canReadOrg) because
// it's tab-specific privilege, same as the old route.
//
// Its old route (src/app/org/[slug]/integrations/page.tsx) is now a redirect().

import { OrgEmpty, SectionHeader } from "@/components/org/shared/ui";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { ingestToken, isIngestConfigured } from "@/lib/integrations/ingest-token";
import { getIngestTokenEpoch, getProviderIngestStatus } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { orgTabHref } from "@/lib/org/orgTabs";
import { listForgeInstallations } from "@/lib/db/forge-installations";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { ForgeInstallationCard } from "./ForgeInstallationCard";

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
  // the live credential rather than the superseded one. A failed lookup falls back to epoch 0 — the
  // display is not the security boundary (the ingest guard is), and showing a stale token is a better
  // failure than blanking the connect surface.
  const epoch = (await getIngestTokenEpoch(slug).catch(() => 0)) ?? 0;
  // What each provider has ACTUALLY delivered. A connector that receives datapoints and stores none
  // of them otherwise looks, on this page, exactly like one that is working.
  const statuses = (await getProviderIngestStatus(slug).catch(() => null)) ?? [];
  // moonshot #4 — the org's connected forge accounts. Secret-free by type: `ForgeInstallationRow`
  // carries `hasCredential`, and has no field the credential could travel in.
  const forgeInstallations = await listForgeInstallations(slug).catch(() => []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description="Connect your AI coding providers so AI delivery has a spend layer at all — until one that reports cost is connected, its money columns are empty rather than estimated."
      />
      {/* Where the CODE is read from, above where the SPEND is read from: a forge connection changes
          which repositories can be scanned at all, which is the more fundamental of the two. */}
      <ForgeInstallationCard
        slug={slug}
        initial={forgeInstallations}
        encryptionConfigured={isEncryptionConfigured()}
      />
      {/* An empty token is the "not configured here" signal: the setup panel renders the operator
          instruction instead of a credential that could never verify. */}
      <IntegrationsPanel
        slug={slug}
        ingestToken={isIngestConfigured() ? ingestToken(slug, epoch) : ""}
        ingestPath="/api/integrations/ingest"
        statuses={statuses}
      />
    </div>
  );
}
