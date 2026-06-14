// Org dashboard "Members" tab — owner-only RBAC management. The org layout gates DB/auth/read
// access for every sub-page; this page adds the owner-role check (members list is sensitive) and
// hands the data to the client panel for inline role changes + removal.

import { SectionEmpty } from "@/components/org/ui";
import { MembersPanel } from "@/components/org/MembersPanel";
import { isDbConfigured, listOrgMembers } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OrgMembers({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isDbConfigured()) {
    return <SectionEmpty>Member management requires a database (set DATABASE_URL).</SectionEmpty>;
  }
  if (!(await hasOrgRole(slug, "owner"))) {
    return (
      <SectionEmpty>
        Only an owner of <span className="font-mono">{slug}</span> can view and manage members.
      </SectionEmpty>
    );
  }
  const [members, session] = await Promise.all([listOrgMembers(slug), getSession()]);
  const initial = members.map((m) => ({
    login: m.login,
    name: m.name,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));
  return <MembersPanel slug={slug} initial={initial} selfLogin={session?.login ?? null} />;
}
