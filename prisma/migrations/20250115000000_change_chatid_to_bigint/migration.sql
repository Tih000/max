-- AlterTable
-- Изменяем тип поля chatId с INTEGER на BIGINT во всех таблицах

-- Message
ALTER TABLE "Message" ALTER COLUMN "chatId" TYPE BIGINT USING "chatId"::BIGINT;

-- Task
ALTER TABLE "Task" ALTER COLUMN "chatId" TYPE BIGINT USING "chatId"::BIGINT;

-- UserChat
ALTER TABLE "UserChat" ALTER COLUMN "chatId" TYPE BIGINT USING "chatId"::BIGINT;

-- DigestLog
ALTER TABLE "DigestLog" ALTER COLUMN "chatId" TYPE BIGINT USING "chatId"::BIGINT;

-- Material
ALTER TABLE "Material" ALTER COLUMN "chatId" TYPE BIGINT USING "chatId"::BIGINT;

-- UserPreference
ALTER TABLE "UserPreference" ALTER COLUMN "selectedChatId" TYPE BIGINT USING "selectedChatId"::BIGINT;

