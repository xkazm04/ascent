-- OPENAI ADMIN COSTS CONNECTOR (backlog develop-2026-09-17 row 47).
--
-- One org's pull credential for an AI-usage provider that is read by ADMIN PULL with a
-- customer-supplied key. `credentialRef` is encryptSecret() ciphertext (AES-256-GCM, ENCRYPTION_KEY),
-- never plaintext; deleting the row destroys the secret, and the org erase drains this table.
-- The last-sync columns record whether the latest pull covered the whole window or stopped short
-- (page cap, rate limit), so a partial pull is never read as a complete one.
--
-- A new table; nothing existing is altered or backfilled. Standalone (no FK, relationMode = "prisma").
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentialRef" TEXT,
    "projectIdsJson" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncDetail" TEXT,
    "lastSyncFrom" TIMESTAMP(3),
    "lastSyncThrough" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_orgId_provider_key" ON "ProviderCredential"("orgId", "provider");

-- CreateIndex
CREATE INDEX "ProviderCredential_orgId_idx" ON "ProviderCredential"("orgId");
