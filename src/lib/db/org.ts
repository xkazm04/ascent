// Enterprise org layer: watchlist, scan scheduling, and the org-rollup queries that power the
// dashboard. This module is a thin BARREL — the implementation lives in the themed org-*.ts
// sub-modules below, and is re-exported here so `@/lib/db/org` (and `@/lib/db`) keep their exact
// public surface. All sub-modules are guarded by DATABASE_URL at their call sites.

export {
  isRepoWatched,
  setRepoWatch,
  setRepoSchedule,
  setWatchedSchedule,
  seedWatchlist,
  listDueRescans,
  advanceSchedule,
  advanceScheduleAfterFailure,
  recordScanOutcome,
  listWatchedRepos,
  listOrgsWithWatchedRepos,
  type RepoRef,
  type DueRescan,
} from "@/lib/db/org-watch";

export {
  getOrgId,
  getRepoStates,
  getOrgRollup,
  type RepoState,
  type OrgRepoRow,
  type OrgWindow,
  type OrgRollup,
} from "@/lib/db/org-rollup";

export {
  getOrgContributors,
  getContributorInsights,
  type OrgContributor,
  type ContributorInsight,
  type RepoConcentration,
  type ContributorInsights,
} from "@/lib/db/org-contributors";

export {
  getOrgPrSignals,
  getOrgGovernance,
  getOrgActivity,
  type OrgPrSignals,
  type RepoGovernance,
  type OrgGovernance,
  type OrgActivity,
} from "@/lib/db/org-signals";

export {
  getOrgMovers,
  getOrgRecommendations,
  getOrgBacklog,
  dueBucketFor,
  getOrgBenchmark,
  getOrgPractices,
  getOrgGapAnalysis,
  getOrgDiscrepancies,
  type RepoMove,
  type OrgMovers,
  type OrgRec,
  type BacklogDueBucket,
  type BacklogItem,
  type BacklogOwnerGroup,
  type BacklogDueGroup,
  type OrgBacklog,
  type OrgBenchmark,
  type OrgPractice,
  type CommonGap,
  type RepoOutlier,
  type OrgGapAnalysis,
  type DiscrepancyGroup,
  type OrgDiscrepancies,
} from "@/lib/db/org-insights";

export {
  getOrgTeamRollup,
  rollupTeams,
  type TeamDimAvg,
  type TeamRepoScore,
  type TeamChampion,
  type TeamRollup,
  type TeamPairing,
  type OrgTeamRollup,
  type TeamRollupRepoInput,
} from "@/lib/db/org-teams";
