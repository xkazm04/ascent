// Persistence + reads for scan reports (history/audit/recommendations). This module is a thin
// BARREL — the implementation lives in the themed scans-*.ts sub-modules below, and is re-exported
// here so `@/lib/db/scans` (and the `@/lib/db` barrel) keep their exact public surface. Every
// function is a no-op or safe fallback when the DB isn't configured, so callers can wire these in
// freely without breaking the DB-less MVP.

export {
  isUniqueConstraintError,
  upsertRacing,
  withRepoLock,
  invalidateOrgIdCache,
} from "@/lib/db/scans-shared";

export { persistScanReport, type PersistResult } from "@/lib/db/scans-persist";

export {
  findScanByCommit,
  getHeadHint,
  getRepositoryHistory,
  getScanComparison,
  getScanReportByCommit,
  getPublicScanGallery,
  getLatestRecommendations,
  reportPermalink,
  type HistoryPoint,
  type RepositoryHistory,
  type ComparableDimension,
  type ComparableRecommendation,
  type ComparableScan,
  type ScanComparison,
  type PublicRepoCard,
  type PublicScanGallery,
} from "@/lib/db/scans-read";

export {
  updateRecommendation,
  updateRecommendationStatus,
  getRecommendationEvents,
  type RecommendationPatch,
  type RecommendationActor,
} from "@/lib/db/scans-recommendations";

export {
  recordAudit,
  getAuditLog,
  type AuditScanRef,
  type AuditLogEntry,
  type AuditLogPage,
  type AuditLogQuery,
} from "@/lib/db/scans-audit";
