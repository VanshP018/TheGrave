-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'ACTIVE', 'FINISHED', 'ABORTED');

-- CreateEnum
CREATE TYPE "MatchEndReason" AS ENUM ('SOLVED', 'TIMEOUT', 'FORFEIT', 'ABANDONED');

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "matchId" UUID;

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "winnerId" UUID,
    "endReason" "MatchEndReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "matchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ratingBefore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("matchId","userId")
);

-- CreateTable
CREATE TABLE "SeenProblem" (
    "userId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeenProblem_pkey" PRIMARY KEY ("userId","problemId")
);

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "MatchPlayer_userId_idx" ON "MatchPlayer"("userId");

-- CreateIndex
CREATE INDEX "SeenProblem_problemId_idx" ON "SeenProblem"("problemId");

-- CreateIndex
CREATE INDEX "Submission_matchId_userId_idx" ON "Submission"("matchId", "userId");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeenProblem" ADD CONSTRAINT "SeenProblem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeenProblem" ADD CONSTRAINT "SeenProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
