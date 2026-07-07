import { OrgEmpty, SectionHeader } from "@/components/org/ui";
import { IntegrationsPanel } from "@/components/org/integrations/IntegrationsPanel";
import { ingestToken } from "@/lib/integrations/ingest-token";
import { hasOrgRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

// Integrations (owner-only) — connect AI coding providers so the /delivery "AI delivery intelligence"
// views run on real usage instead of the simulated placeholder. Built gradually: Claude Code first
// (measured, OTel push); Copilot + OpenAI are staged (allocated) behind a "planned" state. The layout
// already gated org READ; this page additionally requires the owner role since it manages credentials.
export default async function OrgIntegrations({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await hasOrgRole(slug, "owner"))) {
    return (
      <OrgEmpty
        title="Owner only"
        body="Provider integrations are managed by organization owners."
        href={`/org/${slug}`}
        cta="← Overview"
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description="Connect your AI coding providers to replace the simulated spend in AI delivery with real usage — one provider at a time."
      />
      <IntegrationsPanel slug={slug} ingestToken={ingestToken(slug)} ingestPath="/api/integrations/ingest" />
    </div>
  );
}
