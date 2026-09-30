// Props both governance compositions share. The panel resolves them once; v1 and v2 must not
// each re-fetch the overview or the owner check.
import type { ReactNode } from "react";
import type { GovernanceOverview } from "@/lib/org/governance";

export type GovernanceSearchParams = { [key: string]: string | string[] | undefined };

export type GovernanceViewProps = {
  slug: string;
  sp: GovernanceSearchParams;
  g: GovernanceOverview | null;
  canEdit: boolean;
  /** True when ?segment= or ?stack= narrowed who is measured. The policy stays org-wide. */
  scoped: boolean;
  /** Scope filter, built by the panel so neither composition imports org/shared for it. */
  filterBar: ReactNode;
};
