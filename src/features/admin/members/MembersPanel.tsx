"use client";

// Owner-only member management UI — the surface that makes the RBAC backend (Membership.role +
// /api/org/members) usable without curl. Inline role change (optimistic POST) + remove (DELETE,
// refused for the last owner server-side). Owners can grant a teammate viewer/admin without sharing
// the GitHub App installation. The "Invite a teammate" panel lives in the co-located MemberInvites.
//
// Orchestrator only — state/handlers live in useMembersPanel.ts, the table JSX region is
// MembersTable.tsx (split to keep this file under the 200-LOC cap; docs/ORG-TABS-REFACTOR.md).

import { SectionHeader } from "@/components/org/shared/ui";
import { MemberInvites, type InviteRow } from "@/features/admin/members/MemberInvites";
import { MembersTable } from "./MembersTable";
import { useMembersPanel } from "./useMembersPanel";
import type { Member } from "./MembersTypes";

export function MembersPanel({
  slug,
  initial,
  initialInvites,
  selfLogin,
}: {
  slug: string;
  initial: Member[];
  initialInvites: InviteRow[];
  selfLogin: string | null;
}) {
  const p = useMembersPanel(slug, initial, selfLogin);

  return (
    <div>
      <SectionHeader
        className="mb-4"
        title="Members & access"
        description={
          <>
            Who can act on <span className="font-mono">{slug}</span>, and at what role. Grant a
            teammate access without sharing the GitHub App installation. Owner-only.
          </>
        }
      />
      {/* Error alerts use the semantic danger token (not an ad-hoc orange), so the severity signal
          reads the same across MembersPanel / MemberInvites / OrgSwitcher; orange stays reserved for
          genuine warnings like the self-demotion confirm below. (ambiguity-ui 2026-07-16 #5) */}
      {p.error && (
        <p role="alert" className="mb-3 type-body-sm text-danger-soft">
          {p.error}
        </p>
      )}
      <MembersTable
        members={p.members}
        busy={p.busy}
        selfLogin={selfLogin}
        confirmRemove={p.confirmRemove}
        confirmDowngrade={p.confirmDowngrade}
        onRoleSelect={p.onRoleSelect}
        onConfirmDowngrade={(m) => {
          if (!p.confirmDowngrade) return;
          const next = p.confirmDowngrade.role;
          p.setConfirmDowngrade(null);
          void p.changeRole(m.login, next);
        }}
        onCancelDowngrade={() => p.setConfirmDowngrade(null)}
        onRequestRemove={(login) => p.setConfirmRemove(login)}
        onConfirmRemove={(login) => p.remove(login)}
        onCancelRemove={() => p.setConfirmRemove(null)}
      />
      {/* This said "Installation owners are seeded as owner automatically", which stopped being true
          when the custom-OAuth stack was retired: holding the GitHub App installation confers nothing,
          and the only automatic claim left is identity-bound and only on an org that has no owner yet.
          An owner reading the old line would wait for a teammate to appear by installing the App. */}
      <p className="mt-3 type-mono-sm text-slate-500">
        Roles: owner → admin → member → viewer. Everyone else joins by invite or by an owner granting
        them a role here — installing the GitHub App does not grant one. The last owner can&apos;t be
        removed.
      </p>

      <MemberInvites slug={slug} initialInvites={initialInvites} />
    </div>
  );
}
