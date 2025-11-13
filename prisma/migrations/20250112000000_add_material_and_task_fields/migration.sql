-- AlterTable
ALTER TABLE "Task" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "Task" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'medium';

-- AlterTable
ALTER TABLE "Material" ADD COLUMN "type" TEXT;
ALTER TABLE "Material" ADD COLUMN "description" TEXT;
ALTER TABLE "Material" ADD COLUMN "fileType" TEXT;
ALTER TABLE "Material" ADD COLUMN "fileName" TEXT;

-- CreateIndex
-- Note: Some indexes may already exist, but they will be skipped if they do
CREATE INDEX IF NOT EXISTS "Message_senderId_timestamp_idx" ON "Message"("senderId", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_chatId_dueDate_idx" ON "Task"("chatId", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_chatId_status_idx" ON "Task"("chatId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_assigneeId_dueDate_idx" ON "Task"("assigneeId", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_createdByUserId_dueDate_idx" ON "Task"("createdByUserId", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_status_dueDate_idx" ON "Task"("status", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestLog_chatId_generatedFor_idx" ON "DigestLog"("chatId", "generatedFor");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Material_chatId_type_idx" ON "Material"("chatId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Material_chatId_link_idx" ON "Material"("chatId", "link");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Material_link_idx" ON "Material"("link");

