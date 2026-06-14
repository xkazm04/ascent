-- CreateTable: a record of each onboarding-skill generation (STD-6) — repo, commit, the tracks it
-- targeted, and when — so the one-off SKILL.md download becomes a tracked, diffable program.
CREATE TABLE "SkillGeneration" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "headSha" TEXT,
    "trackIds" TEXT NOT NULL DEFAULT '[]',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillGeneration_repoFullName_idx" ON "SkillGeneration"("repoFullName");
