"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assistantService = exports.AssistantService = void 0;
const db_1 = require("../db");
const logger_1 = require("../logger");
const date_1 = require("../utils/date");
const text_1 = require("../utils/text");
const gigachatService_1 = require("./gigachatService");
const preferenceService_1 = require("./preferenceService");
const taskService_1 = require("./taskService");
const ids_1 = require("../utils/ids");
const number_1 = require("../utils/number");
class AssistantService {
    botApi;
    setBotApi(api) {
        this.botApi = api;
    }
    async answerPersonalQuestion(userId, chatId, question, botApi) {
        const userIdString = (0, ids_1.ensureIdString)(userId);
        const timezone = (await preferenceService_1.preferenceService.getOrCreate(userIdString)).timezone;
        const normalizedChatId = chatId ? (0, ids_1.ensureIdString)(chatId) : null;
        const api = botApi ?? this.botApi;
        // Получаем расширенный контекст с историей чата
        const [upcomingTasks, allTasks, materials, recentMessages, chatMembers] = await Promise.all([
            taskService_1.taskService.getPersonalTasks(userIdString, (0, date_1.addDays)(new Date(), 7)),
            normalizedChatId ? taskService_1.taskService.getAllTasks(normalizedChatId, 30) : Promise.resolve([]),
            normalizedChatId
                ? db_1.prisma.material.findMany({
                    where: { chatId: normalizedChatId },
                    orderBy: { createdAt: "desc" },
                    take: 20,
                    distinct: ["link"],
                })
                : Promise.resolve([]),
            normalizedChatId
                ? db_1.prisma.message.findMany({
                    where: {
                        chatId: normalizedChatId,
                        text: { not: null },
                    },
                    orderBy: { timestamp: "desc" },
                    take: 100, // Увеличиваем до 100 сообщений для полного контекста
                    select: {
                        text: true,
                        senderId: true,
                        senderName: true,
                        senderUsername: true,
                        timestamp: true,
                    },
                })
                : Promise.resolve([]),
            // Получаем участников чата
            normalizedChatId && api
                ? (async () => {
                    try {
                        const numericChatId = (0, number_1.toInt)(chatId);
                        if (numericChatId) {
                            const response = await api.getChatMembers(numericChatId);
                            return response.members ?? [];
                        }
                    }
                    catch (error) {
                        logger_1.logger.warn("Не удалось получить участников чата", { error, chatId });
                    }
                    return [];
                })()
                : Promise.resolve([]),
        ]);
        const now = new Date();
        const contextParts = [];
        // Базовая информация
        contextParts.push(`Текущая дата и время: ${(0, date_1.formatDate)(now, timezone)}`);
        contextParts.push(`Таймзона: ${timezone}`);
        // Участники чата и их роли
        if (chatMembers.length > 0) {
            // Анализируем активность участников
            const memberActivity = new Map();
            recentMessages.forEach((msg) => {
                const senderId = msg.senderId ?? "unknown";
                const existing = memberActivity.get(senderId);
                memberActivity.set(senderId, {
                    name: msg.senderName ?? existing?.name ?? "Участник",
                    username: msg.senderUsername ?? existing?.username,
                    messageCount: (existing?.messageCount ?? 0) + 1,
                    lastActivity: existing?.lastActivity && msg.timestamp.getTime() > existing.lastActivity.getTime()
                        ? msg.timestamp
                        : existing?.lastActivity ?? msg.timestamp,
                });
            });
            // Объединяем с информацией из API
            const membersInfo = chatMembers.map((member) => {
                const userId = (0, ids_1.ensureIdString)(member.user_id);
                const activity = memberActivity.get(userId);
                return {
                    id: userId,
                    name: member.name ?? activity?.name ?? "Участник",
                    username: member.username ?? activity?.username ?? undefined,
                    messageCount: activity?.messageCount ?? 0,
                    lastActivity: activity?.lastActivity,
                };
            });
            // Сортируем по активности
            membersInfo.sort((a, b) => b.messageCount - a.messageCount);
            contextParts.push("", `=== УЧАСТНИКИ ЧАТА (${membersInfo.length}) ===`, (0, text_1.formatBulletList)(membersInfo.slice(0, 20).map((member) => {
                const parts = [member.name];
                if (member.username)
                    parts.push(`@${member.username}`);
                if (member.messageCount > 0) {
                    parts.push(`сообщений: ${member.messageCount}`);
                }
                if (member.lastActivity) {
                    const daysAgo = Math.floor((now.getTime() - member.lastActivity.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysAgo === 0)
                        parts.push("активен сегодня");
                    else if (daysAgo === 1)
                        parts.push("активен вчера");
                    else
                        parts.push(`активен ${daysAgo} дн. назад`);
                }
                return parts.join(" | ");
            })));
        }
        // Ближайшие задачи пользователя
        if (upcomingTasks.length > 0) {
            contextParts.push("=== МОИ БЛИЖАЙШИЕ ЗАДАЧИ (на неделю) ===", (0, text_1.formatBulletList)(upcomingTasks.map((task) => {
                const parts = [task.title];
                if (task.dueDate) {
                    const daysLeft = Math.ceil((task.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    parts.push(`дедлайн: ${(0, date_1.formatDate)(task.dueDate, timezone)} (через ${daysLeft} дн.)`);
                }
                if (task.assigneeName)
                    parts.push(`ответственный: ${task.assigneeName}`);
                if (task.description)
                    parts.push(`описание: ${task.description}`);
                return parts.join(" | ");
            })));
        }
        else {
            contextParts.push("=== МОИ БЛИЖАЙШИЕ ЗАДАЧИ ===", "Нет задач на ближайшую неделю.");
        }
        // Все задачи в чате
        if (allTasks.length > 0) {
            contextParts.push("", `=== ВСЕ ЗАДАЧИ В ЧАТЕ (${allTasks.length}) ===`, (0, text_1.formatBulletList)(allTasks.slice(0, 15).map((task) => {
                const parts = [task.title];
                if (task.dueDate)
                    parts.push(`дедлайн: ${(0, date_1.formatDate)(task.dueDate, timezone)}`);
                if (task.assigneeName)
                    parts.push(`ответственный: ${task.assigneeName}`);
                return parts.join(" | ");
            })));
        }
        // Материалы
        if (materials.length > 0) {
            contextParts.push("", `=== МАТЕРИАЛЫ ИЗ ЧАТА (${materials.length}) ===`, (0, text_1.formatBulletList)(materials.map((material) => {
                if (material.link) {
                    return `${material.title}\n   Ссылка: ${material.link}`;
                }
                return material.title;
            })));
        }
        // Полная история сообщений из чата (контекст обсуждений)
        if (recentMessages.length > 0) {
            contextParts.push("", `=== ИСТОРИЯ ЧАТА (последние ${recentMessages.length} сообщений) ===`, recentMessages
                .reverse()
                .map((msg, index) => {
                const author = msg.senderName ?? msg.senderUsername ?? "Участник";
                const time = (0, date_1.formatDate)(msg.timestamp, timezone);
                const text = (0, text_1.sanitizeText)(msg.text ?? "");
                // Для первых и последних сообщений показываем больше текста
                const maxLength = index < 5 || index >= recentMessages.length - 5 ? 300 : 150;
                const truncated = text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
                return `[${time}] ${author}: ${truncated}`;
            })
                .join("\n"));
        }
        const context = contextParts.join("\n\n");
        if (gigachatService_1.gigaChatService.enabled) {
            try {
                const answer = await gigachatService_1.gigaChatService.answerQuestion(question, context, {
                    chatId: normalizedChatId,
                    userId: userIdString,
                    timezone,
                    chatMembers: chatMembers.map((m) => ({
                        id: (0, ids_1.ensureIdString)(m.user_id),
                        name: m.name ?? "Участник",
                        username: m.username ?? undefined,
                    })),
                });
                return {
                    title: "Ответ ассистента",
                    body: answer,
                };
            }
            catch (error) {
                logger_1.logger.error("Ошибка ответа GigaChat", { error, location: "answerPersonalQuestion" });
            }
        }
        return {
            title: "Ответ ассистента (ограниченный режим)",
            body: this.buildFallbackAnswer(question, context),
        };
    }
    async getWeeklyDigest(chatId) {
        const from = (0, date_1.startOfWeek)();
        const to = (0, date_1.endOfWeek)();
        const messages = await db_1.prisma.message.findMany({
            where: {
                chatId: (0, ids_1.ensureIdString)(chatId),
                timestamp: { gte: from, lte: to },
            },
            orderBy: { timestamp: "asc" },
        });
        return (0, text_1.formatBulletList)(messages
            .slice(-5)
            .map((message) => `${message.senderName ?? "Участник"}: ${(0, text_1.sanitizeText)(message.text)}`));
    }
    buildFallbackAnswer(question, context) {
        return [
            "Не удалось использовать ИИ для детального ответа, показываю собранные данные:",
            "",
            `Вопрос: ${question}`,
            "",
            context,
            "",
            "Для более точного ответа настройте интеграцию с GigaChat (переменные окружения GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET).",
        ].join("\n");
    }
}
exports.AssistantService = AssistantService;
exports.assistantService = new AssistantService();
//# sourceMappingURL=assistantService.js.map