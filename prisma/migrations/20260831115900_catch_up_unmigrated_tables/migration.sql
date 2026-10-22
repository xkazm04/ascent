-- CATCH-UP: THE 26 TABLES THE CHAIN NEVER CREATED.
--
-- These models reached prisma/schema.prisma and prisma/init.sql with no migration, so a fresh
-- `prisma migrate deploy` stopped at the very next step: 20260831120000 ALTERs "LaneItemOutcome",
-- which nothing had created ("relation does not exist"), and 20260923120000 does the same to
-- "RepoConformanceMap". This step is dated one minute BEFORE that first broken ALTER, because a
-- corrective step appended at the end cannot unbreak a replay that halts in the middle. It is a NEW
-- step inserted into the chain, not an edit of a shipped one.
--
-- Every statement is IF NOT EXISTS, so on a database that already has these tables (built by db push,
-- by init.sql, or migrated by hand) the step is a no-op. Two columns are deliberately left out because
-- shipped steps add them later in the chain: "LaneItemOutcome"."verifiedAt" (20260831120000) and
-- "RepoConformanceMap"."registryRemote" (20260923120000).
--
-- Additive only, pinned by src/lib/db/migration-chain.test.ts: no DROP, DELETE, UPDATE, TRUNCATE,
-- SET DEFAULT, ADD CONSTRAINT or ALTER ... TYPE. The shapes are lifted from prisma/init.sql.

CREATE TABLE IF NOT EXISTS "ConformanceFinding" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ConformanceFinding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConformanceFinding_reportId_idx" ON "ConformanceFinding"("reportId");
CREATE INDEX IF NOT EXISTS "ConformanceFinding_check_idx" ON "ConformanceFinding"("check");

CREATE TABLE IF NOT EXISTS "ConformanceReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "headSha" TEXT,
    "score" INTEGER NOT NULL,
    "fails" INTEGER NOT NULL,
    "warns" INTEGER NOT NULL,
    "unchecked" INTEGER NOT NULL DEFAULT 0,
    "scored" INTEGER NOT NULL DEFAULT 0,
    "specVersion" TEXT,
    "runShape" TEXT NOT NULL DEFAULT 'plain',
    "summaryOnly" BOOLEAN NOT NULL DEFAULT false,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConformanceReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConformanceReport_orgId_repoFullName_headSha_runShape_key" ON "ConformanceReport"("orgId", "repoFullName", "headSha", "runShape");
CREATE INDEX IF NOT EXISTS "ConformanceReport_orgId_repoFullName_reportedAt_idx" ON "ConformanceReport"("orgId", "repoFullName", "reportedAt");

CREATE TABLE IF NOT EXISTS "ControlLedgerSeal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "root" TEXT NOT NULL,
    "prevRoot" TEXT,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sig" TEXT,
    CONSTRAINT "ControlLedgerSeal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ControlLedgerSeal_orgId_day_key" ON "ControlLedgerSeal"("orgId", "day");
CREATE INDEX IF NOT EXISTS "ControlLedgerSeal_orgId_day_idx" ON "ControlLedgerSeal"("orgId", "day");

CREATE TABLE IF NOT EXISTS "ControlObservation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "repoFullName" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "value" TEXT,
    "prevValue" TEXT,
    "prevState" TEXT,
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "actorLogin" TEXT,
    "transition" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanId" TEXT,
    "jobId" TEXT,
    "deliveryId" TEXT,
    "sig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ControlObservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ControlObservation_deliveryId_controlId_repoFullName_key" ON "ControlObservation"("deliveryId", "controlId", "repoFullName");
CREATE INDEX IF NOT EXISTS "ControlObservation_orgId_repoFullName_controlId_occurredAt_idx" ON "ControlObservation"("orgId", "repoFullName", "controlId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ControlObservation_orgId_occurredAt_idx" ON "ControlObservation"("orgId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ControlObservation_repoId_controlId_observedAt_idx" ON "ControlObservation"("repoId", "controlId", "observedAt");
CREATE INDEX IF NOT EXISTS "ControlObservation_orgId_transition_observedAt_idx" ON "ControlObservation"("orgId", "transition", "observedAt");

CREATE TABLE IF NOT EXISTS "HousePatternVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "exemplarsJson" TEXT NOT NULL DEFAULT '[]',
    "agreementMin" INTEGER NOT NULL DEFAULT 2,
    "patternHash" TEXT NOT NULL,
    "minedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HousePatternVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HousePatternVersion_orgId_practiceId_version_key" ON "HousePatternVersion"("orgId", "practiceId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "HousePatternVersion_orgId_practiceId_patternHash_key" ON "HousePatternVersion"("orgId", "practiceId", "patternHash");
CREATE INDEX IF NOT EXISTS "HousePatternVersion_orgId_practiceId_idx" ON "HousePatternVersion"("orgId", "practiceId");

CREATE TABLE IF NOT EXISTS "Installation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "forge" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "host" TEXT,
    "credentialRef" TEXT,
    "capabilitiesJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Installation_orgId_forge_externalId_key" ON "Installation"("orgId", "forge", "externalId");
CREATE INDEX IF NOT EXISTS "Installation_orgId_idx" ON "Installation"("orgId");

CREATE TABLE IF NOT EXISTS "InterventionOutcome" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "dimId" TEXT,
    "beforeScanId" TEXT NOT NULL,
    "afterScanId" TEXT NOT NULL,
    "interventionAt" TIMESTAMP(3) NOT NULL,
    "overallDelta" INTEGER NOT NULL,
    "dimDelta" INTEGER,
    "rubricVersion" TEXT NOT NULL,
    "engineProvider" TEXT NOT NULL,
    "gapDays" INTEGER NOT NULL,
    "withinBound" BOOLEAN NOT NULL,
    "isPrivateRepo" BOOLEAN NOT NULL,
    "sourceRowId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InterventionOutcome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InterventionOutcome_orgId_kind_identityKey_beforeScanId_afterScanId_key" ON "InterventionOutcome"("orgId", "kind", "identityKey", "beforeScanId", "afterScanId");
CREATE INDEX IF NOT EXISTS "InterventionOutcome_orgId_kind_dimId_idx" ON "InterventionOutcome"("orgId", "kind", "dimId");
CREATE INDEX IF NOT EXISTS "InterventionOutcome_identityKey_dimId_idx" ON "InterventionOutcome"("identityKey", "dimId");
CREATE INDEX IF NOT EXISTS "InterventionOutcome_orgId_recordedAt_idx" ON "InterventionOutcome"("orgId", "recordedAt");

CREATE TABLE IF NOT EXISTS "LaneItemOutcome" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "laneId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "filesJson" TEXT NOT NULL DEFAULT '[]',
    "deferUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LaneItemOutcome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LaneItemOutcome_laneId_recommendationId_key" ON "LaneItemOutcome"("laneId", "recommendationId");
CREATE INDEX IF NOT EXISTS "LaneItemOutcome_orgId_recommendationId_idx" ON "LaneItemOutcome"("orgId", "recommendationId");
CREATE INDEX IF NOT EXISTS "LaneItemOutcome_runId_idx" ON "LaneItemOutcome"("runId");

CREATE TABLE IF NOT EXISTS "OrgKnowledgeSubject" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "bundle" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "subcategory" TEXT,
    "status" TEXT,
    "file" TEXT NOT NULL,
    "techniqueCount" INTEGER NOT NULL DEFAULT 0,
    "useWhenJson" TEXT NOT NULL DEFAULT '[]',
    "lawsJson" TEXT NOT NULL DEFAULT '[]',
    "digest" TEXT,
    "revision" INTEGER,
    "changedAt" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "indexedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgKnowledgeSubject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgKnowledgeSubject_registryId_bundle_slug_key" ON "OrgKnowledgeSubject"("registryId", "bundle", "slug");
CREATE INDEX IF NOT EXISTS "OrgKnowledgeSubject_orgId_bundle_idx" ON "OrgKnowledgeSubject"("orgId", "bundle");

CREATE TABLE IF NOT EXISTS "OrgMemoryCandidate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "namespace" TEXT,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'procedural',
    "source" TEXT NOT NULL,
    "laneId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "promotedMemoryId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMemoryCandidate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrgMemoryCandidate_orgId_status_idx" ON "OrgMemoryCandidate"("orgId", "status");

CREATE TABLE IF NOT EXISTS "OrgMemoryCitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "tokenId" TEXT,
    "actor" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMemoryCitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgMemoryCitation_memoryId_sessionId_key" ON "OrgMemoryCitation"("memoryId", "sessionId");
CREATE INDEX IF NOT EXISTS "OrgMemoryCitation_orgId_createdAt_idx" ON "OrgMemoryCitation"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrgMemoryCitation_memoryId_used_idx" ON "OrgMemoryCitation"("memoryId", "used");

CREATE TABLE IF NOT EXISTS "OrgMemoryProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT,
    "namespace" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'summary',
    "slug" TEXT NOT NULL,
    "summaryContent" TEXT NOT NULL,
    "memberIdsJson" TEXT NOT NULL DEFAULT '[]',
    "memberPathsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "prUrl" TEXT,
    "prNumber" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgMemoryProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgMemoryProposal_orgId_slug_key" ON "OrgMemoryProposal"("orgId", "slug");
CREATE INDEX IF NOT EXISTS "OrgMemoryProposal_orgId_status_idx" ON "OrgMemoryProposal"("orgId", "status");

CREATE TABLE IF NOT EXISTS "OrgSkillLesson" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "registryPath" TEXT NOT NULL,
    "versionUsed" TEXT NOT NULL DEFAULT '',
    "learnedOn" TIMESTAMP(3),
    "project" TEXT NOT NULL DEFAULT '',
    "headingRaw" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "entryHash" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "memoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgSkillLesson_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgSkillLesson_registryId_registryPath_entryHash_key" ON "OrgSkillLesson"("registryId", "registryPath", "entryHash");
CREATE INDEX IF NOT EXISTS "OrgSkillLesson_orgId_skillName_idx" ON "OrgSkillLesson"("orgId", "skillName");
CREATE INDEX IF NOT EXISTS "OrgSkillLesson_registryId_registryPath_idx" ON "OrgSkillLesson"("registryId", "registryPath");

CREATE TABLE IF NOT EXISTS "OrgSkillTrace" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "registryPath" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "entriesJson" TEXT NOT NULL DEFAULT '[]',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgSkillTrace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgSkillTrace_registryId_registryPath_key" ON "OrgSkillTrace"("registryId", "registryPath");
CREATE INDEX IF NOT EXISTS "OrgSkillTrace_orgId_skillName_idx" ON "OrgSkillTrace"("orgId", "skillName");

CREATE TABLE IF NOT EXISTS "OrgSkillUsageSample" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "invokes" INTEGER NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "lastUsedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgSkillUsageSample_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgSkillUsageSample_registryId_contributor_skillName_key" ON "OrgSkillUsageSample"("registryId", "contributor", "skillName");
CREATE INDEX IF NOT EXISTS "OrgSkillUsageSample_orgId_skillName_idx" ON "OrgSkillUsageSample"("orgId", "skillName");

CREATE TABLE IF NOT EXISTS "PracticeAdoption" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "patternVersion" INTEGER,
    "artifactPath" TEXT NOT NULL,
    "proposedHash" TEXT NOT NULL,
    "adoptedHash" TEXT,
    "adoptedOutline" TEXT,
    "state" TEXT NOT NULL DEFAULT 'proposed',
    "improvementPrId" TEXT,
    "prNumber" INTEGER,
    "adoptedAt" TIMESTAMP(3),
    "driftedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastScanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PracticeAdoption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PracticeAdoption_orgId_repoFullName_practiceId_artifactPath_key" ON "PracticeAdoption"("orgId", "repoFullName", "practiceId", "artifactPath");
CREATE INDEX IF NOT EXISTS "PracticeAdoption_orgId_state_idx" ON "PracticeAdoption"("orgId", "state");
CREATE INDEX IF NOT EXISTS "PracticeAdoption_orgId_practiceId_patternVersion_idx" ON "PracticeAdoption"("orgId", "practiceId", "patternVersion");

CREATE TABLE IF NOT EXISTS "RegistryDispatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subjectsJson" TEXT NOT NULL DEFAULT '[]',
    "briefDigest" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "branch" TEXT,
    "prUrl" TEXT,
    "mapShaBefore" TEXT,
    "mapShaAfter" TEXT,
    "model" TEXT,
    "costMicros" INTEGER,
    "turns" INTEGER,
    "agentDurationMs" INTEGER,
    "summary" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "RegistryDispatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RegistryDispatch_orgId_repositoryId_idx" ON "RegistryDispatch"("orgId", "repositoryId");
CREATE INDEX IF NOT EXISTS "RegistryDispatch_orgId_createdAt_idx" ON "RegistryDispatch"("orgId", "createdAt");

CREATE TABLE IF NOT EXISTS "RegistrySignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "app" TEXT,
    "bundle" TEXT NOT NULL,
    "subjectSlug" TEXT NOT NULL,
    "consults" INTEGER,
    "deviations" INTEGER,
    "citResolved" INTEGER,
    "citMoved" INTEGER,
    "citGone" INTEGER,
    "windowDays" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrySignal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RegistrySignal_registryId_contributor_bundle_subjectSlug_key" ON "RegistrySignal"("registryId", "contributor", "bundle", "subjectSlug");
CREATE INDEX IF NOT EXISTS "RegistrySignal_orgId_bundle_idx" ON "RegistrySignal"("orgId", "bundle");

CREATE TABLE IF NOT EXISTS "RegistrySignalContribution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "prUrl" TEXT,
    "commitSha" TEXT,
    "payloadDigest" TEXT NOT NULL,
    "bundlesJson" TEXT NOT NULL DEFAULT '[]',
    "subjects" INTEGER NOT NULL,
    "deviations" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrySignalContribution_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RegistrySignalContribution_orgId_createdAt_idx" ON "RegistrySignalContribution"("orgId", "createdAt");

CREATE TABLE IF NOT EXISTS "RepoAdmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "stanceVersion" INTEGER NOT NULL,
    "derivedTier" TEXT,
    "grantedTier" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'assisted-only',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rationale" TEXT NOT NULL DEFAULT '',
    "rulesetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepoAdmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RepoAdmission_orgId_repoFullName_key" ON "RepoAdmission"("orgId", "repoFullName");
CREATE INDEX IF NOT EXISTS "RepoAdmission_orgId_mode_idx" ON "RepoAdmission"("orgId", "mode");

CREATE TABLE IF NOT EXISTS "RepoConformance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "contextName" TEXT NOT NULL,
    "contextGroup" TEXT,
    "bundle" TEXT NOT NULL,
    "subjectSlug" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "confidence" TEXT,
    "score" DOUBLE PRECISION,
    "evidence" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "evaluatedAgainst" TEXT,
    "evaluatedRevision" INTEGER,
    "revision" INTEGER,
    "arrived" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "mapSha" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepoConformance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RepoConformance_repositoryId_contextName_subjectSlug_key" ON "RepoConformance"("repositoryId", "contextName", "subjectSlug");
CREATE INDEX IF NOT EXISTS "RepoConformance_orgId_subjectSlug_state_idx" ON "RepoConformance"("orgId", "subjectSlug", "state");

CREATE TABLE IF NOT EXISTS "RepoConformanceMap" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "mapSha" TEXT,
    "schema" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "contexts" INTEGER NOT NULL,
    "pairs" INTEGER NOT NULL,
    "judged" INTEGER NOT NULL,
    "deviations" INTEGER NOT NULL,
    "weaklyGoverned" INTEGER NOT NULL,
    "weaklyGovernedJson" TEXT NOT NULL DEFAULT '[]',
    "unmatched" INTEGER NOT NULL,
    "domainsJson" TEXT NOT NULL DEFAULT '[]',
    "bundleDigestsJson" TEXT NOT NULL DEFAULT '{}',
    "consults30d" INTEGER,
    "hasContextMap" BOOLEAN NOT NULL DEFAULT false,
    "hasManifest" BOOLEAN NOT NULL DEFAULT false,
    "scopeJson" TEXT NOT NULL DEFAULT '{}',
    "directionsJson" TEXT NOT NULL DEFAULT '[]',
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "orphanedVerdicts" INTEGER NOT NULL DEFAULT 0,
    "arrivedContexts" INTEGER NOT NULL DEFAULT 0,
    "renamedContexts" INTEGER NOT NULL DEFAULT 0,
    "contextMapRevision" TEXT,
    "repoContextMapRevision" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepoConformanceMap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RepoConformanceMap_repositoryId_key" ON "RepoConformanceMap"("repositoryId");
CREATE INDEX IF NOT EXISTS "RepoConformanceMap_orgId_idx" ON "RepoConformanceMap"("orgId");

CREATE TABLE IF NOT EXISTS "RepoMemoryMirror" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "entryId" TEXT,
    "rawKind" TEXT,
    "mappedKind" TEXT NOT NULL,
    "scope" TEXT,
    "entryDate" TEXT,
    "supersedes" TEXT,
    "refsJson" TEXT NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL,
    "headSha" TEXT,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "orgMemoryId" TEXT,
    "skipReason" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepoMemoryMirror_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RepoMemoryMirror_orgId_repoFullName_path_contentHash_key" ON "RepoMemoryMirror"("orgId", "repoFullName", "path", "contentHash");
CREATE INDEX IF NOT EXISTS "RepoMemoryMirror_orgId_repoFullName_idx" ON "RepoMemoryMirror"("orgId", "repoFullName");
CREATE INDEX IF NOT EXISTS "RepoMemoryMirror_orgId_mappedKind_idx" ON "RepoMemoryMirror"("orgId", "mappedKind");

CREATE TABLE IF NOT EXISTS "ScanDigest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "engineProvider" TEXT NOT NULL,
    "scanCount" INTEGER NOT NULL,
    "overallSum" INTEGER NOT NULL,
    "adoptionSum" INTEGER NOT NULL,
    "rigorSum" INTEGER NOT NULL,
    "overallMin" INTEGER NOT NULL,
    "overallMax" INTEGER NOT NULL,
    "overallLast" INTEGER NOT NULL,
    "adoptionLast" INTEGER NOT NULL,
    "rigorLast" INTEGER NOT NULL,
    "confidenceSum" DOUBLE PRECISION NOT NULL,
    "levelLast" TEXT NOT NULL,
    "levelNameLast" TEXT NOT NULL,
    "postureLast" TEXT NOT NULL,
    "firstScannedAt" TIMESTAMP(3) NOT NULL,
    "lastScannedAt" TIMESTAMP(3) NOT NULL,
    "firstHeadSha" TEXT,
    "lastHeadSha" TEXT,
    "enginesJson" TEXT NOT NULL DEFAULT '[]',
    "dimensionsJson" TEXT NOT NULL DEFAULT '{}',
    "recsOpened" INTEGER NOT NULL DEFAULT 0,
    "recsClosed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScanDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ScanDigest_repoId_period_rubricVersion_engineProvider_key" ON "ScanDigest"("repoId", "period", "rubricVersion", "engineProvider");
CREATE INDEX IF NOT EXISTS "ScanDigest_repoId_lastScannedAt_idx" ON "ScanDigest"("repoId", "lastScannedAt");

CREATE TABLE IF NOT EXISTS "ScanJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "repoFullName" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "runId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "creditCharged" BOOLEAN NOT NULL DEFAULT false,
    "resultJson" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ScanJob_idempotencyKey_key" ON "ScanJob"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ScanJob_lane_state_notBefore_priority_idx" ON "ScanJob"("lane", "state", "notBefore", "priority");
CREATE INDEX IF NOT EXISTS "ScanJob_orgId_lane_state_idx" ON "ScanJob"("orgId", "lane", "state");
CREATE INDEX IF NOT EXISTS "ScanJob_runId_idx" ON "ScanJob"("runId");
CREATE INDEX IF NOT EXISTS "ScanJob_state_leaseUntil_idx" ON "ScanJob"("state", "leaseUntil");

CREATE TABLE IF NOT EXISTS "UsageEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "legKind" TEXT,
    "refId" TEXT,
    "repoId" TEXT,
    "repoFullName" TEXT,
    "teamKey" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "byom" BOOLEAN,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "costMicros" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'success',
    "latencyMs" INTEGER,
    "idemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UsageEvent_idemKey_key" ON "UsageEvent"("idemKey");
CREATE INDEX IF NOT EXISTS "UsageEvent_orgId_createdAt_idx" ON "UsageEvent"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_orgId_lane_createdAt_idx" ON "UsageEvent"("orgId", "lane", "createdAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_orgId_teamKey_createdAt_idx" ON "UsageEvent"("orgId", "teamKey", "createdAt");

