// Shared types for the Members tab, extracted from MembersPanel.tsx (docs/ORG-TABS-REFACTOR.md).

import type { OrgRole } from "@/lib/db/members";

export interface Member {
  login: string;
  name: string | null;
  role: OrgRole;
  createdAt: string;
}
