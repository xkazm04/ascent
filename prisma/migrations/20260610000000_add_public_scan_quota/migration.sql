-- CreateTable
CREATE TABLE "PublicScanQuota" (
    "ipHash" TEXT NOT NULL,
    "hits" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicScanQuota_pkey" PRIMARY KEY ("ipHash")
);
