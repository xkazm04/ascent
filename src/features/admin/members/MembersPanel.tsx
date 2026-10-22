"use client";

// The composition of the member roster: a masthead that states who holds the keys (owners, admins,
// the rest, pending invites), then hairline Frames for the roster and for invites instead of a heading over
// a boxed table. Hook, same table and invite panel.
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { Caption, Frame, Masthead, Notice, SectionHead, type MastheadFigure } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import { MemberInvites } from "./MemberInvites";
import { MembersTable } from "./MembersTable";
import type { MembersPanelProps } from "./MembersPanel.props";
import { useMembersPanel } from "./useMembersPanel";

export function MembersPanel({ slug, initial, initialInvites, selfLogin, canManage }: MembersPanelProps) {
  const p = useMembersPanel(slug, initial, selfLogin);
  const count = (role: string) => p.members.filter((m) => m.role === role).length;
  const figures: MastheadFigure[] = [
    { label: "Owners", value: count("owner") },
    { label: "Admins", value: count("admin") },
    { label: "Members and viewers", value: count("member") + count("viewer") },
    ...(canManage ? [{ label: "Pending invites", value: initialInvites.length }] : []),
  ];
  return (
    <div data-role="members-v2" className="stagger-children space-y-10">
      <Masthead
        eyebrow="Admin · access"
        statement={`${p.members.length} ${p.members.length === 1 ? "person" : "people"} can act on`}
        named={slug}
        lede={
          canManage
            ? "Grant a teammate access without sharing the GitHub App installation. Owner-only."
            : "Only an owner can change roles, invite a teammate or remove a member."
        }
        figures={figures}
        pattern="dots"
      />
      {p.error && (
        <Notice>{p.error}</Notice>
      )}
      <Frame edge="both" aria-label="Roster">
        <SectionHead eyebrow="Roster" title="Who holds" named="which role." />
        <div className="mt-5">
          <MembersTable
            members={p.members}
            busy={p.busy}
            selfLogin={selfLogin}
            canManage={canManage}
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
          <Caption className="mt-3 block">
            Roles: owner → admin → member → viewer. Everyone else joins by invite or by an owner granting them a
            role here; installing the GitHub App does not grant one. The last owner can&apos;t be removed.
          </Caption>
        </div>
      </Frame>
      {canManage && (
        <Frame aria-label="Invites">
          <SectionHead eyebrow="Invites" title="Bring in" named="a teammate." />
          <div className="mt-5">
            <MemberInvites slug={slug} initialInvites={initialInvites} members={p.members} />
          </div>
        </Frame>
      )}
      <NextMoveLink href={orgTabHref(slug, "repositories")} to="repositories" />
    </div>
  );
}
