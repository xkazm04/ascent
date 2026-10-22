// What the Proposals tab reads once on the server and hands to a composition (v1 Altimeter, v2 Prism).
// Both compositions take this same shape, so the reads and the counts cannot differ between themes.
import type { ComponentProps } from "react";
import type { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import type { ClaimViewer } from "@/components/org/followups/claimActionsModel";
import type { ProposalRow } from "./proposalsModel";

export interface ProposalsTabData {
  slug: string;
  rows: ProposalRow[];
  barProps: ComponentProps<typeof ScopeFilterBar>;
  /** Repos paired with a working copy on this server (local mode); empty on managed cloud. */
  pairedRepos: string[];
  initialDim?: string;
  canReview: boolean;
  viewer: ClaimViewer;
  counts: { open: number; handedOff: number; loop: number; points: number };
}
