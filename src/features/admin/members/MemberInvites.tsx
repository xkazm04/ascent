"use client";

// Owner-only "Invite a teammate" panel. POST /api/org/invites mints or resends a single-use
// /invite/[token] link; the roster (InviteList) revokes and one-click resends. The token is the
// capability, shown once on the create/resend response. `emailed` is disclosed so a provider-less
// deploy is not a silent success.

import type { OrgRole } from "@/lib/db/members";
import { INVITE_ROLES } from "@/features/admin/members/memberRoles";
import { InviteList } from "./InviteList";
import type { InviteRow, Member } from "./MembersTypes";
import { useMemberInvites } from "./useMemberInvites";
import { InviteBatchPreview, InviteBatchResults } from "./InviteBatchPreview";

// Re-exported so the panel and the tab keep importing it from here (pure relocation).
export type { InviteRow };


/** The `emailed` wire vocabulary, rendered from ONE table keyed by the wire token — label and
 *  severity together, so a future member cannot gain a colour in one place and a sentence in
 *  another. `null` is absent from the table on purpose: it means "no address was involved", which is
 *  not a delivery outcome to report. */
const DELIVERY: Record<"sent" | "skipped" | "failed", { alert: boolean; cls: string; text: (to: string) => string }> = {
  sent: {
    alert: false,
    cls: "text-slate-400",
    text: (to) => `Invitation emailed to ${to}.`,
  },
  skipped: {
    alert: false,
    cls: "text-orange-300",
    text: (to) => `Nothing was sent to ${to} — this deployment has no email provider. Copy the link below and share it yourself.`,
  },
  failed: {
    alert: true,
    cls: "text-danger-soft",
    text: (to) => `Couldn't email ${to}. The invite is valid — copy the link below and share it yourself.`,
  },
};

const NO_MEMBERS: readonly Member[] = [];

export function MemberInvites({
  slug,
  initialInvites,
  members = NO_MEMBERS,
}: {
  slug: string;
  initialInvites: InviteRow[];
  /** The roster already on the page: the batch preview judges a paste against it with no fetch. */
  members?: readonly Member[];
}) {
  const {
    invites, inviteTarget, setInviteTarget, inviteRole, setInviteRole, inviteBusy, inviteError, copied,
    delivery, preview, batchResults, dismissResults, submit, resendInvite, revokeInvite, copyLink,
  } = useMemberInvites(slug, initialInvites, members);

  return (
    <div className="mt-6 border-t border-slate-800 pt-4">
      <h3 className="type-mono-sm uppercase tracking-widest text-accent">Invite a teammate</h3>
      <p className="mt-1 type-body-sm text-slate-500">
        Creates a single-use link (expires in 7 days). A GitHub login pins the invite to that account.
        Owner is granted by promoting an existing member, not by invite.
      </p>
      {/* data-tour: the onboarding companion's "bring the team in" spotlight — the whole invite form. */}
      <div data-tour="invite-member" className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={inviteTarget}
          onChange={(e) => setInviteTarget(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="GitHub login or email (paste several to invite a team)"
          className="min-w-[14rem] flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200 outline-none focus:border-accent"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as OrgRole)}
          aria-label="Invite role"
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 type-mono-sm text-slate-200 outline-none focus:border-accent"
        >
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {!preview && (
          <button
            onClick={() => void submit()}
            disabled={inviteBusy || !inviteTarget.trim()}
            className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
          >
            {inviteBusy ? "Creating…" : "Create invite"}
          </button>
        )}
      </div>
      {preview && (
        <InviteBatchPreview
          rows={preview.rows}
          counts={preview.counts}
          tooMany={preview.tooMany}
          busy={inviteBusy}
          onConfirm={() => void submit()}
        />
      )}
      {batchResults && <InviteBatchResults results={batchResults} onResend={resendInvite} onDismiss={dismissResults} />}
      {inviteError && (
        <p role="alert" className="mt-2 type-body-sm text-danger-soft">
          {inviteError}
        </p>
      )}
      {delivery && (
        <p
          data-testid="invite-delivery"
          {...(DELIVERY[delivery.status].alert ? { role: "alert" as const } : {})}
          className={`mt-2 type-body-sm ${DELIVERY[delivery.status].cls}`}
        >
          {DELIVERY[delivery.status].text(delivery.to)}
        </p>
      )}

      <InviteList invites={invites} copied={copied} onCopy={copyLink} onRevoke={revokeInvite} onResend={resendInvite} />
    </div>
  );
}
