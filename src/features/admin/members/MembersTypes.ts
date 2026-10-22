// Shared types for the Members tab, extracted from MembersPanel.tsx (docs/ORG-TABS-REFACTOR.md).
// InviteRow joined them from MemberInvites.tsx when that file reached the 200-LOC cap
// `src/features/**` carries; MemberInvites still re-exports it, so no call site changed.

import type { OrgRole } from "@/lib/db/members";

export interface Member {
  login: string;
  name: string | null;
  role: OrgRole;
  createdAt: string;
}

export interface InviteRow {
  id: string;
  email: string | null;
  githubLogin: string | null;
  role: OrgRole;
  /** GitHub login of the owner who created it. Written by createInvite on every invite and carried
   *  through PendingInviteSummary; null on a pre-Supabase-wall row, where the actor was unresolvable. */
  invitedBy?: string | null;
  // Present only for invites created in THIS session (the POST create response). Pre-existing
  // pending invites loaded from the server no longer carry the token (it's the capability, shown
  // once), so the copy-link affordance appears only right after creation.
  token?: string | null;
  expiresAt: string;
}

/** The `emailed` wire vocabulary of a create/resend response; null means no address was involved. */
export type DeliveryStatus = "sent" | "skipped" | "failed";

/** One row of a POST /api/org/invites { action: "batch" } response, in the caller's input order.
 *  The server re-classified the target (src/lib/org/invite-batch.ts) and has the final say. */
export type InviteBatchResult =
  | { target: string; outcome: "created"; invite: InviteRow; emailed: DeliveryStatus | null }
  | { target: string; outcome: "already_member"; role: OrgRole }
  | { target: string; outcome: "already_pending"; inviteId: string }
  | { target: string; outcome: "invalid" | "duplicate" | "failed" };
