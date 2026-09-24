// Org dashboard "Members" tab. The org layout gates DB/auth/read access for every tab; this tab adds
// two role checks. Member and up see the roster (login, display name, role, joined); only an owner
// gets the management surface (inline role changes, removal, invites). A viewer gets the refusal, and
// a non-owner is never sent the pending invites, which carry invitee emails (backlog
// develop-2026-09-17 row 4, operator decision 2026-09-24). SERVER component, filename PINNED
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
  // Owner first, sequentially: the owner check is the one that may bootstrap an identity-verified
  // owner on an ownerless org, and a non-owner then needs the member check alone.
  const canManage = await hasOrgRole(slug, "owner");
  if (!canManage && !(await hasOrgRole(slug, "member"))) {
    return (
      <SectionEmpty>
        The member roster of <span className="font-mono">{slug}</span> is visible to members, admins and
        owners. Your role here is read-only; ask an owner if you need it.
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
    canManage ? listPendingInvites(slug) : Promise.resolve([]),
    resolveViewerLogin(),
  ]);
  const initial = members.map((m) => ({
    login: m.login,
    name: m.name,
    role: m.role,
    createdAt: m.createdAt,
  }));
  // NB: listPendingInvites no longer returns the raw token (it's the capability — shown once at
  // creation), so the tab bundle / RSC payload no longer carries live acceptance tokens.
  const initialInvites = invites.map((i) => ({
    id: i.id,
    email: i.email,
    githubLogin: i.githubLogin,
    role: i.role,
    invitedBy: i.invitedBy,
    expiresAt: i.expiresAt,
  }));
  return (
    <MembersPanel
      slug={slug}
      initial={initial}
      initialInvites={initialInvites}
      selfLogin={selfLogin}
      canManage={canManage}
    />
  );
}
