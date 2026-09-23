-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "outOfGroup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "ownerOutOfGroup" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CrossGroupAssignment" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "taskId" INTEGER,
    "milestoneId" INTEGER,
    "taskCode" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "milestoneContent" TEXT,
    "assignerId" INTEGER NOT NULL,
    "assigneeId" INTEGER NOT NULL,
    "assigneeLeadId" INTEGER,
    "reason" TEXT,

    CONSTRAINT "CrossGroupAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrossGroupAssignment_createdAt_idx" ON "CrossGroupAssignment"("createdAt");

-- CreateIndex
CREATE INDEX "CrossGroupAssignment_assignerId_idx" ON "CrossGroupAssignment"("assignerId");

-- CreateIndex
CREATE INDEX "CrossGroupAssignment_assigneeId_idx" ON "CrossGroupAssignment"("assigneeId");

-- AddForeignKey
ALTER TABLE "CrossGroupAssignment" ADD CONSTRAINT "CrossGroupAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossGroupAssignment" ADD CONSTRAINT "CrossGroupAssignment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossGroupAssignment" ADD CONSTRAINT "CrossGroupAssignment_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossGroupAssignment" ADD CONSTRAINT "CrossGroupAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossGroupAssignment" ADD CONSTRAINT "CrossGroupAssignment_assigneeLeadId_fkey" FOREIGN KEY ("assigneeLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
