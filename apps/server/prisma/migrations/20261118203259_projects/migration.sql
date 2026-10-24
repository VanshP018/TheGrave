-- CreateEnum
CREATE TYPE "ProjectLanguage" AS ENUM ('python', 'node');

-- CreateEnum
CREATE TYPE "ProjectRunKind" AS ENUM ('COMMAND', 'TEST', 'SUBMIT');

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "language" "ProjectLanguage" NOT NULL,
    "summary" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "files" JSONB NOT NULL,
    "hiddenTests" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ProjectRunKind" NOT NULL,
    "command" TEXT,
    "files" JSONB NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'QUEUED',
    "exitCode" INTEGER,
    "output" TEXT,
    "timedOut" BOOLEAN NOT NULL DEFAULT false,
    "passed" INTEGER,
    "total" INTEGER,
    "results" JSONB,
    "timeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "ProjectRun_userId_projectId_createdAt_idx" ON "ProjectRun"("userId", "projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectRun" ADD CONSTRAINT "ProjectRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRun" ADD CONSTRAINT "ProjectRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
