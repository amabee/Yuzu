-- CreateTable
CREATE TABLE "SavedBoardView" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
    "config" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedBoardView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardViewSelection" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viewId" TEXT,

    CONSTRAINT "BoardViewSelection_pkey" PRIMARY KEY ("boardId","userId")
);

-- CreateIndex
CREATE INDEX "SavedBoardView_boardId_ownerId_idx" ON "SavedBoardView"("boardId", "ownerId");

-- CreateIndex
CREATE INDEX "BoardViewSelection_viewId_idx" ON "BoardViewSelection"("viewId");

-- AddForeignKey
ALTER TABLE "SavedBoardView" ADD CONSTRAINT "SavedBoardView_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedBoardView" ADD CONSTRAINT "SavedBoardView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardViewSelection" ADD CONSTRAINT "BoardViewSelection_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardViewSelection" ADD CONSTRAINT "BoardViewSelection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardViewSelection" ADD CONSTRAINT "BoardViewSelection_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "SavedBoardView"("id") ON DELETE SET NULL ON UPDATE CASCADE;
