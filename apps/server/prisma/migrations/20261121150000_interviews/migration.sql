-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "InterviewStage" AS ENUM ('QUEUED', 'FETCHING', 'READING', 'WRITING', 'REVIEWING', 'DONE');

-- CreateEnum
CREATE TYPE "InterviewLevel" AS ENUM ('AUTO', 'INTERN', 'JUNIOR', 'MID', 'SENIOR');

-- CreateEnum
CREATE TYPE "InterviewCategory" AS ENUM ('ARCHITECTURE', 'DESIGN_TRADEOFF', 'CODE_QUALITY', 'BUG_RISK', 'TESTING', 'PERFORMANCE_SCALING', 'SECURITY', 'DEPENDENCIES', 'DATA_MODEL', 'DEVOPS');

-- CreateTable
CREATE TABLE "InterviewAnalysis" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "ref" TEXT,
    "commitSha" TEXT,
    "requestedLevel" "InterviewLevel" NOT NULL DEFAULT 'AUTO',
    "apparentLevel" "InterviewLevel",
    "status" "InterviewStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "InterviewStage" NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB,
    "profile" JSONB,
    "cacheKey" TEXT,
    "cachedFromId" UUID,
    "charged" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "InterviewAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" UUID NOT NULL,
    "analysisId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "category" "InterviewCategory" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "question" TEXT NOT NULL,
    "whyAsked" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "strongAnswer" JSONB NOT NULL,
    "followUps" JSONB NOT NULL,
    "redFlags" JSONB NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewAnalysis_userId_createdAt_idx" ON "InterviewAnalysis"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InterviewAnalysis_cacheKey_status_idx" ON "InterviewAnalysis"("cacheKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewQuestion_analysisId_position_key" ON "InterviewQuestion"("analysisId", "position");

-- AddForeignKey
ALTER TABLE "InterviewAnalysis" ADD CONSTRAINT "InterviewAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "InterviewAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
