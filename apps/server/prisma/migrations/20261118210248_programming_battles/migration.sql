-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('DSA', 'PROGRAMMING');

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_problemId_fkey";

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "mode" "MatchMode" NOT NULL DEFAULT 'DSA',
ADD COLUMN     "projectId" UUID,
ALTER COLUMN "problemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProjectRun" ADD COLUMN     "matchId" UUID;

-- CreateIndex
CREATE INDEX "ProjectRun_matchId_userId_idx" ON "ProjectRun"("matchId", "userId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRun" ADD CONSTRAINT "ProjectRun_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
