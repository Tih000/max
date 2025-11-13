-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN "selectedChatId" TEXT;

-- CreateTable
CREATE TABLE "UserChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "chatTitle" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserChat_userId_chatId_key" ON "UserChat"("userId", "chatId");

-- CreateIndex
CREATE INDEX "UserChat_userId_idx" ON "UserChat"("userId");

