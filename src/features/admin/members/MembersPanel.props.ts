// Props of the member roster (MembersPanel.v2, Prism).
import type { InviteRow, Member } from "./MembersTypes";

export interface MembersPanelProps {
  slug: string;
  initial: Member[];
  initialInvites: InviteRow[];
  selfLogin: string | null;
  /** Owner-only: role editors, remove and invites. Required, so no caller gets them by omission. */
  canManage: boolean;
}
