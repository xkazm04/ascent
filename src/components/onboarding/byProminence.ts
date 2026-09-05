import type { OrgRepo } from "@/components/onboarding/types";

/** Rank repos for preselection: most-starred first, then most-recently-pushed. The recency
 *  tie-break is what makes the installation path (private repos, usually 0 stars) preselect the
 *  repos a user actually works in, while public listings still lead with their popular repos. */
export const byProminence = (a: OrgRepo, b: OrgRepo) =>
  b.stars - a.stars || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");
