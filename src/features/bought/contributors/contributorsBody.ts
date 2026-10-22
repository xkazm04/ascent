// The shape the Contributors body composition takes: everything the panel
// read and settled, so the two cannot disagree about data. Types only.

import type { ReactNode } from "react";
import type { ContributorInsights } from "@/lib/db";
import type { resolveOrgScope } from "@/lib/org/scope";
import type { resolveOrgWindow } from "@/lib/org/period";
import type { decisionMap } from "@/lib/org/decision-map";
import type { enablementTargets } from "@/lib/org/adoption";

export type ContributorsBodyProps = {
  slug: string;
  insights: ContributorInsights;
  period: Awaited<ReturnType<typeof resolveOrgWindow>> | null | undefined;
  filterBar: ReactNode;
  viewerLogin: string | null;
  segmentId: Awaited<ReturnType<typeof resolveOrgScope>>["segmentId"];
  activeStack: Awaited<ReturnType<typeof resolveOrgScope>>["activeStack"];
  decisions: Awaited<ReturnType<typeof decisionMap>>;
  decisionsFailed: boolean;
  enablement: ReturnType<typeof enablementTargets>;
  /** Is the viewer one of the people this tab describes (below the naming floor nobody is). */
  meInRoster: boolean;
};
