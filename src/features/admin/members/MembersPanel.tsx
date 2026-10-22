"use client";

// The member roster entry: the Prism composition (MembersPanel.v2, kit parts) over the useMembersPanel hook.

import { MembersPanelV2 } from "./MembersPanel.v2";
import type { MembersPanelProps } from "./MembersPanel.props";

export function MembersPanel(props: MembersPanelProps) {
  return <MembersPanelV2 {...props} />;
}
