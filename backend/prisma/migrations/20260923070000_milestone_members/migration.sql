-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "doneManually" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MilestoneMember" (
    "id" SERIAL NOT NULL,
    "milestoneId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "assignedById" INTEGER,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "percent" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATE,
    "note" TEXT,
    "outOfGroup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MilestoneMember_userId_idx" ON "MilestoneMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneMember_milestoneId_userId_key" ON "MilestoneMember"("milestoneId", "userId");

-- AddForeignKey
ALTER TABLE "MilestoneMember" ADD CONSTRAINT "MilestoneMember_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneMember" ADD CONSTRAINT "MilestoneMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneMember" ADD CONSTRAINT "MilestoneMember_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
