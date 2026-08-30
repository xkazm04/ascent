// Guards the fattest server surface in the app: a client component that reaches this barrel for a
// VALUE (rather than `import type`) now fails the build here, naming this module, instead of failing
// downstream with a message about next/headers. See Architect ADR 2026-08-28-server-only-boundary.
import "server-only";

export {
  getPrisma,
  isDbConfigured,
  withDb,
  withRetry,
  reconnectDb,
  dbHealthCheck,
  isAuthExpiryError,
  isSerializationConflictError,
  isDbUnavailableError,
  dbReadSafe,
  pgliteBootError,
  type RetryOptions,
} from "@/lib/db/client";
export {
  persistScanReport,
  findScanByCommit,
  getHeadHint,
  getRepositoryHistory,
  getScanComparison,
  getScanReportByCommit,
  getRepoPassport,
  getLatestRecommendations,
  getLatestPlatformSignals,
  updateRecommendation,
  getRecommendationEvents,
  getRecommendationOrgSlug,
  handoffRecommendations,
  getOrphanedTrackedRecommendations,
  recordAudit,
  recordOrgAudit,
  getAuditLog,
  getPublicScanGallery,
  reportPermalink,
  type PersistResult,
  type RecommendationPatch,
  type RecommendationActor,
  type HandoffOutcome,
  type OrphanedTrackedRec,
  type RepositoryHistory,
  type HistoryPoint,
  type ScanComparison,
  type ComparableScan,
  type ComparableDimension,
  type ComparableRecommendation,
  type PublicRepoCard,
  type PublicScanGallery,
  type AuditLogEntry,
  type AuditLogPage,
  type AuditLogQuery,
  type AuditScanRef,
} from "@/lib/db/scans";
export {
  purgeExpiredData,
  eraseOrgData,
  envRetentionDefaults,
  resolveRetention,
  clampBatchSize,
  PURGE_ACTION,
  ERASE_ACTION,
  RETENTION_DEFAULT_BATCH_SIZE,
  type RetentionPolicy,
  type OrgPurgeResult,
  type PurgeSummary,
  type EraseRequest,
  type EraseResult,
  type EraseOutcome,
} from "@/lib/db/retention";
export { getUsageSummary, type UsageSummary, type ProviderUsage, type UsageDay } from "@/lib/db/usage";
export { recordQuotaEvent, getQuotaEventTotals, type QuotaEventTotals } from "@/lib/db/quota-events";
export { transactPublicScanQuota, type QuotaWindowDecision } from "@/lib/db/scan-quota";
// The adopted product KPIs, measured from the data already stored (see the module header).
export {
  firstScanActivationRate,
  reScanRate,
  freeToPaidConversion,
  orgFleetScanDepth,
  roadmapEngagementRate,
  weeklyActiveScanningOrgs,
  avgLlmCostPerScan,
  scanPipelineErrorRate,
  scanOutputBudget,
  type RatioMetric,
  type ScanCostMetric,
  type ScanErrorRateMetric,
  type OutputBudgetMetric,
} from "@/lib/db/kpi-metrics";
export { recordSkillGeneration, getSkillHistory, diffTrackSets, type SkillGenerationRow } from "@/lib/db/skill-history";
export { getOrgBranding, setOrgBranding, type OrgBranding } from "@/lib/db/branding";
export {
  getCreditState,
  grantCredits,
  clawbackOrderRefund,
  consumeScanCredit,
  countMeteredScansThisMonth,
  getCreditLedger,
  getCreditReconciliation,
  sumRefundClawback,
  setOrgPlan,
  CREDIT_REASON,
  isRefundReason,
  type CreditState,
  type CreditLedgerEntry,
  type CreditReconciliation,
} from "@/lib/db/credits";
export {
  ensureOwnerMembership,
  getMembershipRole,
  setMembershipRole,
  removeMembership,
  listOrgMembers,
  listOrgsForLogin,
  getAlertsWatermark,
  markAlertsSeen,
  type OrgRole,
  type OrgMember,
  type ViewerOrg,
  type AlertsWatermark,
} from "@/lib/db/members";
export {
  getOnboardingStamp,
  setOnboardingStamp,
  isOnboardingStatus,
  getGettingStartedFacts,
  EMPTY_GETTING_STARTED_FACTS,
  type OnboardingStamp,
  type OnboardingStatus,
  type GettingStartedFacts,
} from "@/lib/db/org-onboarding";
export {
  getOrgMovementSince,
  MOVEMENT_CAP,
  type OrgMovement,
  type OrgMovementItem,
} from "@/lib/db/org-movement";
export {
  createInvite,
  listPendingInvites,
  revokeInvite,
  acceptInvite,
  peekInvite,
  type PendingInvite,
  type PendingInviteSummary,
  type InvitePeek,
  type AcceptResult,
} from "@/lib/db/invites";
export {
  upsertInstallation,
  removeInstallation,
  suspendInstallation,
  resumeInstallation,
  reconcileWatchedRepos,
  getInstallationIdForOwner,
} from "@/lib/db/installations";
export { getSessionVersion, bumpSessionVersion } from "@/lib/db/sessions";
export { claimWebhookDelivery, releaseWebhookDelivery } from "@/lib/db/webhook-deliveries";
export { recordAlertEvent, listAlertEvents, type AlertEventInput, type AlertEventKind, type AlertEventRow } from "@/lib/db/alert-events";
// Single source of truth for the org-layer surface: org.ts is itself a re-export barrel over the
// themed org-*.ts sub-modules (watch/rollup/alerts/gate/contributors/signals/insights/teams), so a
// wildcard re-export here can never drift from what org.ts actually exports — unlike the prior
// hand-copied name list, which had already fallen out of sync (missing getOrgEngineMix,
// getOrgRecsActioned, claimRepoScan, releaseRepoScan). Purely additive vs. the old list; nothing
// previously exported from "@/lib/db" is removed.
export * from "@/lib/db/org";
export {
  persistTeamStandings,
  getTeamStandingsProvenance,
  type TeamStandingsProvenance,
} from "@/lib/db/team-standings";
export {
  listSegments,
  createSegment,
  updateSegment,
  deleteSegment,
  setRepoSegment,
  setRepoSegmentsBulk,
  getSegmentOrgSlug,
  getRepoSegmentMap,
  listTaggableRepos,
  compareSegments,
  listSegmentSummaries,
  buildSegmentComparison,
  normalizeSegmentName,
  normalizeColor,
  segmentInputError,
  type SegmentRow,
  type TaggableRepo,
  type SegmentSummary,
  type SegmentComparison,
} from "@/lib/db/segments";
export {
  createGoal,
  listGoals,
  updateGoal,
  deleteGoal,
  getGoalOrgSlug,
  isGoalMetric,
  metricLabel,
  GOAL_PCT_LABEL,
  type GoalProgress,
  type GoalMetric,
  type GoalPctBasis,
} from "@/lib/db/plan";
export {
  listPlaybooks,
  getPlaybook,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  getPlaybookOrgSlug,
  applyPlaybook,
  unapplyPlaybook,
  getPlaybookAdoption,
  type PlaybookRow,
  type PlaybookInput,
  type PlaybookAdoption,
} from "@/lib/db/playbooks";
export {
  listOrgSkills,
  getOrgSkill,
  getOrgSkillOrgSlug,
  createOrgSkill,
  updateOrgSkill,
  archiveOrgSkill,
  getOrgSkillAdoption,
  listOrgSkillAdoptionRows,
  getOrgSkillUsageRows,
  adoptOrgSkill,
  unadoptOrgSkill,
  recordSkillDownload,
  listOrgSkillManifest,
  pushOrgSkill,
  recordSkillEvents,
  isSkillEventType,
  type SkillRow,
  type SkillInput,
  type SkillSort,
  type SkillListOpts,
  type SkillAdoption,
  type SkillAdoptionRow,
  type SkillEventStat,
  type SkillUsageRows,
  type SkillManifestEntry,
  type SkillPushResult,
  type SkillEventType,
  type SkillEventInput,
} from "@/lib/db/org-skills";
export {
  createOrgApiToken,
  listOrgApiTokens,
  revokeOrgApiToken,
  verifyOrgApiToken,
  isSkillTokenScope,
  SKILL_TOKEN_SCOPES,
  type SkillTokenScope,
  type ApiTokenSummary,
  type VerifiedApiToken,
} from "@/lib/db/org-api-tokens";
export {
  listOrgMemories,
  listOrgMemoryNamespaces,
  getOrgMemory,
  getOrgMemoryOrgSlug,
  createOrgMemory,
  updateOrgMemory,
  archiveOrgMemory,
  candidateOrgMemories,
  recordMemoryRecall,
  SupersedeTargetNotFoundError,
  type MemoryRow,
  type MemoryInput,
  type MemorySort,
  type MemoryListOpts,
} from "@/lib/db/org-memory";
export {
  lifecycleWorkingSet,
  bumpMemoryAccessCounts,
  archiveOrgMemories,
  applyReflection,
  ReflectionMembersNotFoundError,
  type LifecycleFetchOpts,
  type ApplyReflectionInput,
} from "@/lib/db/org-memory-lifecycle";
export {
  syncTechStackGroups,
  listTechStackGroups,
  getTechGroupIdByKey,
  listTechStackSummaries,
  type TechGroupSummary,
} from "@/lib/db/tech-groups";
export { getDbMode, dbModeLabel, dbModeIsAws, type DbMode } from "@/lib/db/mode";
export { getPassportOverrides, mergePassportDeclines, setPassportOverrides } from "@/lib/db/passport-overrides";
export {
  getOrgLlmConfig,
  setOrgLlmConfig,
  disableOrgLlmConfig,
  recordOrgLlmValidation,
  isByomActive,
  resolveByomProvider,
  type OrgLlmConfigPublic,
  type OrgLlmConfigInput,
  type ByomProviderParams,
} from "@/lib/db/org-llm";
export {
  recordUsage,
  getOrgUsageRollup,
  getIngestTokenEpoch,
  bumpIngestTokenEpoch,
  getProviderIngestStatus,
  type ProviderIngestStatus,
  type UsageRecordInput,
  type UsageScope,
  type UsageFidelity,
  type RepoUsage,
  type OrgUsageRollup,
} from "@/lib/db/integrations";
export {
  listOpsState,
  countInFlightPrs,
  acceptDirection,
  rejectDirection,
  refreshOps,
  recordPracticePr,
  mockPrsEnabled,
  type OpsState,
  type OpsTriageItem,
  type OpsPrItem,
  type OpsAcceptResult,
} from "@/lib/db/improvement";

export { getOrgNavCounts, getOrgPassportBlockers, type OrgNavCounts, type OrgPassportBlockers } from "@/lib/db/org-nav-counts";
export {
  decide,
  listDecisions,
  resolvedKeys,
  isDecisionStatus,
  isResolved,
  DECISION_STATUSES,
  type DecisionStatus,
  type DecisionRow,
  type DecideInput,
} from "@/lib/db/org-decisions";
export { decisionsForRepo, type DecisionNote } from "@/lib/db/org-decisions";
export {
  ROADMAP_DECISION_MODULE,
  isDecisionModule,
  recommendationDecisionKey,
  recordRecommendationDismissal,
  clearRecommendationDismissal,
  type DecisionModule,
  type RecommendationDismissal,
} from "@/lib/db/org-decisions";
export {
  getSandboxScenario,
  saveSandboxScenario,
  deleteSandboxScenario,
  MAX_SCENARIO_ITEM_KEYS,
  type SandboxScenarioRecord,
  type SandboxScenarioInput,
} from "@/lib/db/sandbox-scenario";
export {
  getPersonalWatchlist,
  countPersonalWatched,
  isPersonalOrg,
  workspaceAllowsMemory,
  workspaceAllowsSkills,
  personalMemoryCapReached,
  personalSkillCapReached,
  getPersonalUsage,
  type PersonalUsage,
  type PersonalMeter,
  PERSONAL_WATCH_LIMIT,
  PERSONAL_MEMORY_LIMIT,
  PERSONAL_SKILL_LIMIT,
  type PersonalRepo,
  type PersonalScanPoint,
} from "@/lib/db/personal";
export { getPersonalSecurityRows, type PersonalSecurityRow } from "@/lib/db/personal-security";
export { getPersonalPassports, type PersonalPassport } from "@/lib/db/personal-passports";
export {
  getPersonalBacklog,
  setPersonalOverlay,
  OverlayRepoNotWatchedError,
  type PersonalBacklog,
  type PersonalBacklogRepo,
  type PersonalBacklogItem,
} from "@/lib/db/personal-backlog";
export {
  createPlanEnquiry,
  recordPlanEnquiryEmail,
  type PlanEnquiryRecord,
  type StoredPlanEnquiry,
  type EnquiryEmailStatus,
} from "@/lib/db/plan-enquiry";
export {
  listLocalPairings,
  getRepoLocalPath,
  setRepoLocalPath,
  type LocalPairing,
} from "@/lib/db/org-local";
export { countTenantOrgs } from "@/lib/db/tenants";
// ── MOONSHOT wave 1 — barrel lines landed by the Director at integration ─────────────────────────
export { getCompactionCoverage, digestPeriod, digestScans, type CompactedPoint, type ScanDigestRow } from "@/lib/db/scan-digest";
export { getFoundationRollout, type FoundationRolloutRow } from "@/lib/db/org-foundation";
export { ensureOrgApiToken, revokeOrgApiTokensByName } from "@/lib/db/org-api-tokens";
export { recordOutcome, recordOutcomes, listOrgOutcomes, backfillOutcomes, type InterventionOutcomeRow, type OutcomeKind } from "@/lib/db/outcomes";
export { recordUsageEvent, laneTotals, teamTotals, listUsageEvents, type UsageEventRow, type LaneUsage, type TeamUsage } from "@/lib/db/usage-events";
export { upsertMirrorEntries, listRepoDeadEnds, countMirrored, type RepoMemoryEntryRow } from "@/lib/db/repo-memory";
export { listOrgSkillUsageSamples, recordUsageSamples, purgeUsageSamples, type SkillUsageSampleRow } from "@/lib/db/org-skill-usage-samples";
export { listSkillLessons, replaceSkillLessons, purgeSkillLessons, type SkillLessonRow } from "@/lib/db/org-skill-lessons";
export { getSkillTrace, putSkillTrace, type SkillTraceRow } from "@/lib/db/org-skill-trace";
export { createMemoryProposal, setMemoryProposalPr, type MemoryProposalRow } from "@/lib/db/org-registry-proposals";
// ── MOONSHOT wave 2 — barrel lines landed by the Director at integration ─────────────────────────
export * from "@/lib/db/practice-adoption";
export * from "@/lib/db/house-pattern-versions";
export { recordMemoryCitation, citationCountsFor, listMemoryCitations, type MemoryCitationRow } from "@/lib/db/org-memory-citations";
export * from "@/lib/db/lane-brief-read";
export * from "@/lib/db/lane-outcomes";
export * from "@/lib/db/loop-lessons";
export { foldImprovementEvents, getImprovementEvents, recordLoopPr } from "@/lib/db/improvement-events";
// ── MOONSHOT wave 3 — barrel lines landed by the Director at integration ─────────────────────────
export * from "@/lib/db/scan-jobs";
export * from "@/lib/db/control-observations";
// ── MOONSHOT wave 4 — barrel lines landed by the Director at integration ─────────────────────────
export { claimFollowups, releaseFollowups, reportAttempt, sweepExpiredLeases, heldFollowups, type FollowupClaimRow, type ClaimRefusal } from "@/lib/db/followup-claims";
