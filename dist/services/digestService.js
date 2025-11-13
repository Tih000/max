"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.digestService = exports.DigestService = void 0;
const config_1 = require("../config");
const db_1 = require("../db");
const logger_1 = require("../logger");
const date_1 = require("../utils/date");
const text_1 = require("../utils/text");
const gigachatService_1 = require("./gigachatService");
const ids_1 = require("../utils/ids");
const number_1 = require("../utils/number");
class DigestService {
    botApi;
    setBotApi(api) {
        this.botApi = api;
    }
    async generateDigest(chatId, chatTitle, range, options = {}, botApi) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        const messages = await db_1.prisma.message.findMany({
            where: {
                chatId: normalizedChatId,
                timestamp: {
                    gte: range.from,
                    lte: range.to,
                },
                text: {
                    not: null,
                },
            },
            orderBy: {
                timestamp: "asc",
            },
            take: config_1.appConfig.DIGEST_MAX_MESSAGES,
        });
        if (messages.length === 0) {
            return "За выбранный период сообщений не найдено.";
        }
        // Получаем участников чата для контекста
        const api = botApi ?? this.botApi;
        let chatMembers = [];
        if (api) {
            try {
                const numericChatId = (0, number_1.toInt)(chatId);
                if (numericChatId) {
                    const response = await api.getChatMembers(numericChatId);
                    chatMembers = (response.members ?? []).map((m) => ({
                        user_id: m.user_id,
                        name: m.name,
                        username: m.username ?? null,
                    }));
                }
            }
            catch (error) {
                logger_1.logger.warn("Не удалось получить участников чата для дайджеста", { error, chatId, location: "generateDigest" });
            }
        }
        // Анализируем активность участников за период
        const memberActivity = new Map();
        messages.forEach((message) => {
            const senderId = message.senderId ?? "unknown";
            const existing = memberActivity.get(senderId);
            memberActivity.set(senderId, {
                name: message.senderName ?? existing?.name ?? "Участник",
                username: message.senderUsername ?? existing?.username,
                messageCount: (existing?.messageCount ?? 0) + 1,
            });
        });
        // Объединяем информацию об участниках
        const membersInfo = chatMembers.length > 0
            ? chatMembers.map((member) => {
                const userId = (0, ids_1.ensureIdString)(member.user_id);
                const activity = memberActivity.get(userId);
                return {
                    id: userId,
                    name: member.name ?? activity?.name ?? "Участник",
                    username: member.username ?? activity?.username,
                    messageCount: activity?.messageCount ?? 0,
                };
            })
            : Array.from(memberActivity.entries()).map(([id, activity]) => ({
                id,
                name: activity.name,
                username: activity.username,
                messageCount: activity.messageCount,
            }));
        const prepared = messages.map((message) => ({
            author: message.senderName ?? `@${message.senderUsername ?? message.senderId ?? "unknown"}`,
            text: message.text ?? "",
            timestamp: message.timestamp,
            senderId: message.senderId,
        }));
        const preparedMessages = prepared
            .map((m) => {
            const dateStr = (0, date_1.formatDate)(m.timestamp, config_1.appConfig.DEFAULT_TIMEZONE);
            return `${dateStr} — ${m.author}: ${(0, text_1.sanitizeText)(m.text)}`;
        })
            .join("\n");
        // Получаем материалы за период
        const materials = await db_1.prisma.material.findMany({
            where: {
                chatId: normalizedChatId,
                createdAt: {
                    gte: range.from,
                    lte: range.to,
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            take: 50, // Ограничиваем количество для промпта
        });
        // Дедупликация материалов по ссылке
        const uniqueMaterials = new Map();
        materials.forEach((material) => {
            const key = material.link
                ? material.link.toLowerCase().trim()
                : (material.title?.toLowerCase().trim() ?? "");
            if (key && !uniqueMaterials.has(key)) {
                uniqueMaterials.set(key, material);
            }
        });
        const deduplicatedMaterials = Array.from(uniqueMaterials.values());
        if (gigachatService_1.gigaChatService.enabled) {
            try {
                logger_1.logger.debug(`Попытка суммирования GigaChat для чата ${normalizedChatId}`, { chatId: normalizedChatId, messagesCount: prepared.length, materialsCount: deduplicatedMaterials.length });
                let summary = await gigachatService_1.gigaChatService.summarizeChat(chatTitle, preparedMessages, range, options, membersInfo, deduplicatedMaterials);
                // Постобработка: заменяем секцию материалов на правильно отформатированную версию
                logger_1.logger.debug("Постобработка дайджеста: замена секции материалов", {
                    chatId: normalizedChatId,
                    materialsCount: deduplicatedMaterials.length,
                    summaryLengthBefore: summary.length,
                });
                summary = this.replaceMaterialsSection(summary, deduplicatedMaterials);
                logger_1.logger.debug("Постобработка дайджеста завершена", {
                    chatId: normalizedChatId,
                    summaryLengthAfter: summary.length,
                    hasMaterialsSection: summary.includes("📎 **МАТЕРИАЛЫ**"),
                });
                await this.saveDigest(normalizedChatId, range, summary, options.audienceUserId ?? null);
                logger_1.logger.debug(`Суммирование GigaChat успешно, длина: ${summary.length}`, { summaryLength: summary.length });
                return summary;
            }
            catch (error) {
                logger_1.logger.error("Ошибка суммирования GigaChat, используется fallback дайджест", { error, chatId: normalizedChatId, location: "generateDigest" });
                // Продолжаем с fallback дайджестом
            }
        }
        else {
            logger_1.logger.debug(`GigaChat отключен, используется fallback дайджест для чата ${normalizedChatId}`, { chatId: normalizedChatId });
        }
        const fallback = this.buildFallbackDigest(prepared, range);
        await this.saveDigest(normalizedChatId, range, fallback, options.audienceUserId ?? null);
        logger_1.logger.debug(`Fallback дайджест сгенерирован, длина: ${fallback.length}`, { fallbackLength: fallback.length });
        return fallback;
    }
    async saveDigest(chatId, range, summary, createdBy) {
        await db_1.prisma.digestLog.create({
            data: {
                chatId,
                from: range.from,
                to: range.to,
                summary,
                createdBy: (0, ids_1.ensureIdString)(createdBy) ?? undefined,
                generatedFor: new Date(),
            },
        });
    }
    async getLastDigests(chatId, limit = 5) {
        return db_1.prisma.digestLog.findMany({
            where: { chatId: (0, ids_1.ensureIdString)(chatId) },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
    }
    /**
     * Добавляет или заменяет секцию материалов в дайджесте на правильно отформатированную версию
     * (как в разделе "Материалы")
     */
    replaceMaterialsSection(summary, materials) {
        // Используем ТОЧНО ту же функцию форматирования, что и в разделе "Материалы"
        const formattedMaterials = materials.length > 0
            ? (0, text_1.formatMaterials)(materials)
            : "";
        // Создаем секцию материалов с тем же форматом заголовка, что и в разделе "Материалы"
        // В разделе "Материалы" заголовок: "📎 Материалы из чата (количество):"
        // В дайджесте используем: "📎 **МАТЕРИАЛЫ**" для соответствия стилю дайджеста
        const materialsSection = materials.length > 0
            ? `📎 **МАТЕРИАЛЫ**\n\n${formattedMaterials}`
            : "";
        // Удаляем ВСЕ существующие секции материалов из дайджеста (любые варианты)
        // Используем регулярное выражение для поиска и удаления всей секции материалов
        // Находим секцию от "📎 **МАТЕРИАЛЫ**" до следующего раздела или конца текста
        const materialsSectionPatterns = [
            // Паттерн 1: От 📎 **МАТЕРИАЛЫ** до следующего раздела с эмодзи
            /📎\s*\*\*МАТЕРИАЛЫ\*\*[\s\S]*?(?=\n\n(👥|🎯|📅)\s*\*\*(АКТИВНОСТЬ|СЛЕДУЮЩИЕ|ДЕДЛАЙНЫ))/i,
            // Паттерн 2: От 📎 **МАТЕРИАЛЫ** до следующего раздела без эмодзи
            /📎\s*\*\*МАТЕРИАЛЫ\*\*[\s\S]*?(?=\n\n\*\*(АКТИВНОСТЬ|СЛЕДУЮЩИЕ|ДЕДЛАЙНЫ))/i,
            // Паттерн 3: От 📎 **МАТЕРИАЛЫ** до конца текста
            /📎\s*\*\*МАТЕРИАЛЫ\*\*[\s\S]*$/i,
            // Паттерн 4: От 📎 МАТЕРИАЛЫ (без **) до следующего раздела
            /📎\s*МАТЕРИАЛЫ[\s\S]*?(?=\n\n(👥|🎯|📅)\s*\*\*(АКТИВНОСТЬ|СЛЕДУЮЩИЕ|ДЕДЛАЙНЫ))/i,
            // Паттерн 5: От 📎 МАТЕРИАЛЫ до конца текста
            /📎\s*МАТЕРИАЛЫ[\s\S]*$/i,
        ];
        // Применяем все паттерны для удаления секции материалов
        for (const pattern of materialsSectionPatterns) {
            summary = summary.replace(pattern, "");
        }
        // Также удаляем строки, которые выглядят как материалы (начинаются с дефиса и содержат ссылки)
        // Это нужно для случаев, когда GigaChat генерирует материалы без заголовка
        const lines = summary.split("\n");
        const cleanedLines = [];
        let skipMaterialsLikeLines = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === undefined)
                continue;
            // Проверяем, является ли строка началом следующего раздела
            const isNextSection = /^(👥|🎯|📅)\s*\*\*\s*(АКТИВНОСТЬ|СЛЕДУЮЩИЕ|ДЕДЛАЙНЫ)/i.test(line) ||
                /^\*\*\s*(АКТИВНОСТЬ|СЛЕДУЮЩИЕ|ДЕДЛАЙНЫ)/i.test(line);
            // Проверяем, является ли строка материалом (дефис + ссылка или жирный текст)
            const looksLikeMaterial = /^\s*-\s*\[?\*\*/.test(line) || // Дефис + жирный текст
                /^\s*-\s*\[/.test(line) || // Дефис + ссылка
                (/^\s*-\s*/.test(line) && line.includes("](http")); // Дефис + ссылка в строке
            if (isNextSection) {
                skipMaterialsLikeLines = false;
                cleanedLines.push(line);
                continue;
            }
            if (looksLikeMaterial && skipMaterialsLikeLines) {
                // Пропускаем строки, которые выглядят как материалы
                continue;
            }
            // Если видим строку с отступом после материала, тоже пропускаем
            if (skipMaterialsLikeLines && /^\s{3,}/.test(line) && line.trim() !== "") {
                continue;
            }
            if (looksLikeMaterial) {
                skipMaterialsLikeLines = true;
                continue;
            }
            skipMaterialsLikeLines = false;
            cleanedLines.push(line);
        }
        summary = cleanedLines.join("\n");
        // Удаляем лишние пустые строки (более 2 подряд)
        summary = summary.replace(/\n{3,}/g, "\n\n");
        // Удаляем пустые строки в начале и конце
        summary = summary.trim();
        // Добавляем правильно отформатированную секцию материалов после дедлайнов, перед активностью участников
        if (materials.length > 0) {
            // Ищем место для вставки: после дедлайнов, перед активностью участников или следующими шагами
            const activityMatch = summary.match(/\n\n👥\s*\*\*АКТИВНОСТЬ/i);
            const nextStepsMatch = summary.match(/\n\n🎯\s*\*\*СЛЕДУЮЩИЕ/i);
            const deadlinesMatch = summary.match(/📅\s*\*\*ДЕДЛАЙНЫ/i);
            let insertIndex = -1;
            let needsNewlineBefore = false;
            if (deadlinesMatch && deadlinesMatch.index !== undefined) {
                // Найдена секция дедлайнов - вставляем после неё
                // Ищем конец секции дедлайнов (до следующего раздела)
                const afterDeadlines = summary.slice(deadlinesMatch.index);
                const endMatch = afterDeadlines.match(/\n\n(👥|🎯)/);
                if (endMatch && endMatch.index !== undefined) {
                    // Найден следующий раздел - вставляем перед ним
                    insertIndex = deadlinesMatch.index + endMatch.index;
                    needsNewlineBefore = true;
                }
                else {
                    // Секция дедлайнов в конце текста - вставляем после последней задачи
                    // Ищем последнюю строку с задачей (начинается с пробелов и дефиса/маркера)
                    const lines = summary.split("\n");
                    let lastTaskLineIndex = -1;
                    for (let i = lines.length - 1; i >= deadlinesMatch.index; i--) {
                        const line = lines[i];
                        if (line && /^\s+[-•]\s/.test(line)) {
                            lastTaskLineIndex = i;
                            break;
                        }
                    }
                    if (lastTaskLineIndex !== -1) {
                        // Находим позицию конца последней задачи (включая саму строку)
                        const beforeLastTask = lines.slice(0, lastTaskLineIndex + 1).join("\n");
                        insertIndex = beforeLastTask.length;
                    }
                    else {
                        // Не нашли задачи, вставляем в конец
                        insertIndex = summary.length;
                    }
                    needsNewlineBefore = true;
                }
            }
            else if (activityMatch && activityMatch.index !== undefined) {
                // Вставляем перед активностью участников
                insertIndex = activityMatch.index;
                needsNewlineBefore = true;
            }
            else if (nextStepsMatch && nextStepsMatch.index !== undefined) {
                // Вставляем перед следующими шагами
                insertIndex = nextStepsMatch.index;
                needsNewlineBefore = true;
            }
            else {
                // Вставляем в конец
                insertIndex = summary.length;
                needsNewlineBefore = true;
            }
            if (insertIndex !== -1) {
                const before = summary.slice(0, insertIndex).replace(/\n+$/, ""); // Убираем лишние пустые строки в конце
                const after = summary.slice(insertIndex).replace(/^\n+/, ""); // Убираем лишние пустые строки в начале
                // Вставляем секцию материалов с правильными отступами
                if (needsNewlineBefore) {
                    summary = before + "\n\n" + materialsSection + (after ? "\n\n" + after : "");
                }
                else {
                    summary = before + materialsSection + (after ? "\n\n" + after : "");
                }
            }
        }
        // Удаляем лишние пустые строки в конце
        summary = summary.replace(/\n{3,}$/, "\n\n");
        return summary;
    }
    buildFallbackDigest(messages, range) {
        // Группируем сообщения по авторам для анализа активности
        const authorCounts = new Map();
        messages.forEach((msg) => {
            const count = authorCounts.get(msg.author) ?? 0;
            authorCounts.set(msg.author, count + 1);
        });
        const topAuthors = Array.from(authorCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([author, count]) => `• **${author}** — ${count} сообщений`);
        const firstMessages = messages.slice(0, 5).map((message) => {
            const text = (0, text_1.sanitizeText)(message.text);
            const preview = text.length > 100 ? `${text.substring(0, 100)}...` : text;
            return `• ${message.author}: ${preview}`;
        });
        const lastMessages = messages.slice(-5).map((message) => {
            const text = (0, text_1.sanitizeText)(message.text);
            const preview = text.length > 100 ? `${text.substring(0, 100)}...` : text;
            return `• ${message.author}: ${preview}`;
        });
        return [
            `📊 **Дайджест обсуждений**`,
            `*Период: ${(0, date_1.formatRange)(range.from, range.to)}*`,
            "",
            "📌 **Ключевые темы**",
            "",
            ...firstMessages.slice(0, 3),
            "",
            "👥 **Активность участников**",
            "",
            ...topAuthors,
            "",
            "💬 **Последние активности**",
            "",
            ...lastMessages,
            "",
            `📈 *Всего сообщений: ${messages.length}*`,
        ].join("\n");
    }
}
exports.DigestService = DigestService;
exports.digestService = new DigestService();
//# sourceMappingURL=digestService.js.map