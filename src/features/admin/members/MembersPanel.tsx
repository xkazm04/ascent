"use client";

// The member roster entry. Picks the composition by theme: MembersPanel.v1 (Altimeter, the shipped
// markup) or MembersPanel.v2 (Prism, kit parts). Both call the same useMembersPanel hook and render the
// same MembersTable / MemberInvites, so behaviour cannot diverge. `theme` comes from the server entry
// (MembersTab reads the cookie); it defaults to Altimeter so a direct render is the shipped look.

import type { ThemeId } from "@/lib/theme/theme";
import { MembersPanelV1 } from "./MembersPanel.v1";
import { MembersPanelV2 } from "./MembersPanel.v2";
import type { MembersPanelProps } from "./MembersPanel.props";

export function MembersPanel({ theme = "altimeter", ...props }: MembersPanelProps & { theme?: ThemeId }) {
  return theme === "prism" ? <MembersPanelV2 {...props} /> : <MembersPanelV1 {...props} />;
}
