-- DropIndex
DROP INDEX "Scan_repoId_headSha_idx";

-- AlterTable
ALTER TABLE "CreditLedger" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "alertWebhookUrl" TEXT;

-- AlterTable
ALTER TABLE "Playbook" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_externalId_key" ON "CreditLedger"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Scan_repoId_headSha_key" ON "Scan"("repoId", "headSha");

