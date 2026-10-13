-- CreateTable
CREATE TABLE "AuthenticationAttempt" (
    "id" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "AuthenticationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthenticationAttempt_windowStart_idx" ON "AuthenticationAttempt"("windowStart");
