// Org dashboard "Members" tab — owner-only RBAC management. The org layout gates DB/auth/read
// access for every tab; this tab adds the owner-role check (members list is sensitive) and hands the
// data to the client panel for inline role changes + removal. SERVER component, filename PINNED
// (docs/ORG-TABS-REFACTOR.md; see AuditTab.tsx for the worked example).
//
// Its old route (src/app/org/[slug]/members/page.tsx) is now a redirect().

import { SectionEmpty } from "@/components/org/shared/ui";
import { MembersPanel } from "./MembersPanel";
import { isDbConfigured, listOrgMembers, listPendingInvites } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";

export async function MembersTab({ slug }: { slug: string }) {
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
  // Resolve "who am I" across BOTH auth stacks (custom session first, then the ACTIVE Supabase
  // viewer) — the same precedence the routes use. This used to read the DORMANT getSession() only:
  // under the Supabase wall it was always null in prod, so MembersPanel never showed the "you"
  // badge and the self-demotion confirm gate silently never fired — an owner could lock themselves
  // out with one unconfirmed select change (the invite page had the identical bug, fixed earlier).
  const [members, invites, selfLogin] = await Promise.all([
    listOrgMembers(slug),
    listPendingInvites(slug),
    resolveViewerLogin(),
  ]);
  const initial = members.map((m) => ({
    login: m.login,
    name: m.name,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));
  // NB: listPendingInvites no longer returns the raw token (it's the capability — shown once at
  // creation), so the tab bundle / RSC payload no longer carries live acceptance tokens.
  const initialInvites = invites.map((i) => ({
    id: i.id,
    email: i.email,
    githubLogin: i.githubLogin,
    role: i.role,
    expiresAt: i.expiresAt,
  }));
  return <MembersPanel slug={slug} initial={initial} initialInvites={initialInvites} selfLogin={selfLogin} />;
}
