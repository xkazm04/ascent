import { LlmProviderSettings } from "@/components/org/LlmProviderSettings";
import { OrgEmpty, SectionHeader } from "@/components/org/ui";
import { getCreditState, getOrgLlmConfig } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";

export const dynamic = "force-dynamic";

// Org settings (owner-only) — the home for org-level configuration (§8.5). Today: BYOM (connect your
// own Bedrock). The layout already gated org READ; this page additionally requires the owner role since
// the settings here are privileged config.
export default async function OrgSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await hasOrgRole(slug, "owner"))) {
    return <OrgEmpty title="Owner only" body="Organization settings are available to organization owners." href={`/org/${slug}`} cta="← Overview" />;
  }
  const [config, credit] = await Promise.all([getOrgLlmConfig(slug), getCreditState(slug).catch(() => null)]);

  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" description="Organization configuration — owner only." />
      <LlmProviderSettings
        slug={slug}
        initial={config}
        planAllowed={planAllowsByom(credit?.plan)}
        encryptionConfigured={isEncryptionConfigured()}
      />
    </div>
  );
}
