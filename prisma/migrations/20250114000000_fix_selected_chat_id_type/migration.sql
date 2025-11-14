-- AlterTable
-- Изменяем тип поля selectedChatId с TEXT на INTEGER
-- Сначала удаляем NULL значения (если есть)
UPDATE "UserPreference" SET "selectedChatId" = NULL WHERE "selectedChatId" IS NOT NULL AND "selectedChatId" !~ '^[0-9]+$';

-- Изменяем тип поля
ALTER TABLE "UserPreference" ALTER COLUMN "selectedChatId" TYPE INTEGER USING CASE 
  WHEN "selectedChatId" IS NULL THEN NULL
  WHEN "selectedChatId" ~ '^[0-9]+$' THEN "selectedChatId"::INTEGER
  ELSE NULL
END;

