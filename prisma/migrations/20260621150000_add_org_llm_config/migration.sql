-- BYOM (Feature 1): per-org connected LLM (Amazon Bedrock). The credential is stored ONLY in the
-- AES-256-GCM encrypted blob (credentialsEncrypted) — never a plain column. One row per org. No FKs.

-- CreateTable
CREATE TABLE "OrgLlmConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'bedrock',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "modelId" TEXT NOT NULL,
    "region" TEXT,
    "authMode" TEXT NOT NULL DEFAULT 'static',
    "credentialsEncrypted" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgLlmConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgLlmConfig_orgId_key" ON "OrgLlmConfig"("orgId");
