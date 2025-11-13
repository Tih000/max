"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskService = exports.TaskService = void 0;
const db_1 = require("../db");
const logger_1 = require("../logger");
const date_1 = require("../utils/date");
const text_1 = require("../utils/text");
const ids_1 = require("../utils/ids");
const gigachatService_1 = require("./gigachatService");
const preferenceService_1 = require("./preferenceService");
const reminderService_1 = require("./reminderService");
const DEFAULT_REMINDER_OFFSET_MINUTES = 120;
class TaskService {
    async processIncomingMessage(message, context) {
        const text = (0, text_1.sanitizeText)(message.body.text);
        if (!text) {
            return [];
        }
        const parsedTasks = [];
        // Используем только LLM parser для точного определения дедлайнов
        // Heuristic parser отключен, так как он создает много ложных срабатываний
        if (!gigachatService_1.gigaChatService.enabled) {
            logger_1.logger.debug("GigaChat не включен, задачи не извлекаются", {
                messageText: text.substring(0, 200),
                location: "processIncomingMessage",
            });
            return [];
        }
        try {
            // Получаем существующие задачи для предотвращения дубликатов
            const chatId = (0, ids_1.ensureIdString)(message.recipient.chat_id);
            const existingTasks = await db_1.prisma.task.findMany({
                where: { chatId },
                select: { title: true, dueDate: true },
                take: 20,
            });
            // Формируем контекст из последних сообщений для лучшего понимания
            const recentMessages = await db_1.prisma.message.findMany({
                where: {
                    chatId,
                    text: { not: null },
                },
                orderBy: { timestamp: "desc" },
                take: 10, // Увеличиваем контекст до 10 сообщений
                select: { text: true, senderName: true, timestamp: true },
            });
            const contextMessages = recentMessages
                .reverse()
                .map((msg) => `${msg.senderName ?? "Участник"}: ${(0, text_1.sanitizeText)(msg.text ?? "").substring(0, 200)}`)
                .join("\n");
            const llmTasks = await gigachatService_1.gigaChatService.extractTasks(text, contextMessages || context, existingTasks);
            // Логируем результат извлечения задач (только если LOG_LEVEL=debug или если задач не найдено)
            if (process.env.LOG_LEVEL === "debug" || llmTasks.length === 0) {
                logger_1.logger.debug("Извлечение задач из сообщения", {
                    messageText: text.substring(0, 200),
                    tasksFound: llmTasks.length,
                    tasks: llmTasks.map((t) => ({
                        title: t.title,
                        dueDate: t.dueDate,
                        assigneeName: t.assigneeName,
                    })),
                    location: "processIncomingMessage",
                });
            }
            parsedTasks.push(...llmTasks);
        }
        catch (error) {
            logger_1.logger.warn("Ошибка извлечения задач GigaChat", {
                error: error instanceof Error ? error.message : String(error),
                messageText: text.substring(0, 200),
                location: "processIncomingMessage",
            });
            // Если ИИ недоступен, не создаем задачи (лучше не создать, чем создать ложную)
        }
        const uniqueTasks = this.mergeTasks(parsedTasks);
        const createdTasks = [];
        for (const task of uniqueTasks) {
            const created = await this.createOrUpdateTask(task, message);
            if (created) {
                createdTasks.push(created);
            }
        }
        return createdTasks;
    }
    async getUpcomingTasks(chatId, until) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        return db_1.prisma.task.findMany({
            where: {
                chatId: normalizedChatId,
                dueDate: {
                    not: null,
                    lte: until,
                },
            },
            orderBy: {
                dueDate: "asc",
            },
            take: 50,
            include: {
                reminders: true,
            },
        });
    }
    async getPersonalTasks(userId, until) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        return db_1.prisma.task.findMany({
            where: {
                OR: [
                    { assigneeId: normalizedUserId },
                    { createdByUserId: normalizedUserId },
                ],
                dueDate: {
                    not: null,
                    lte: until,
                },
            },
            orderBy: {
                dueDate: "asc",
            },
            take: 50,
            include: {
                reminders: true,
            },
        });
    }
    async getAllTasks(chatId, limit = 50) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        return db_1.prisma.task.findMany({
            where: {
                chatId: normalizedChatId,
            },
            orderBy: {
                dueDate: "asc",
            },
            take: limit,
            include: {
                reminders: true,
            },
        });
    }
    mergeTasks(tasks) {
        const map = new Map();
        tasks.forEach((task) => {
            if (!task.title) {
                return;
            }
            // Безопасно преобразуем dueDate в строку для ключа
            const dueDateStr = task.dueDate instanceof Date
                ? task.dueDate.toISOString()
                : task.dueDate
                    ? String(task.dueDate)
                    : "";
            const key = `${task.title.toLowerCase()}|${dueDateStr}`;
            if (!map.has(key)) {
                map.set(key, task);
            }
        });
        return Array.from(map.values());
    }
    async createOrUpdateTask(task, message) {
        const chatId = (0, ids_1.ensureIdString)(message.recipient.chat_id);
        const sourceMessageId = message.body.mid;
        const existing = await db_1.prisma.task.findFirst({
            where: {
                sourceMessageId,
                title: task.title,
            },
        });
        const data = {
            chatId,
            title: task.title,
            description: task.description,
            dueDate: task.dueDate ?? null,
            assigneeId: (0, ids_1.toIdString)(task.assigneeId) ?? undefined,
            assigneeName: task.assigneeName ?? undefined,
            sourceMessageId,
            createdByUserId: (0, ids_1.toIdString)(message.sender?.user_id) ?? undefined,
            createdByName: message.sender?.name ?? undefined,
        };
        let saved;
        if (existing) {
            saved = await db_1.prisma.task.update({
                where: { id: existing.id },
                data,
            });
        }
        else {
            saved = await db_1.prisma.task.create({
                data,
            });
        }
        if (saved.dueDate) {
            const userId = saved.assigneeId ?? (0, ids_1.toIdString)(message.sender?.user_id);
            let offset = DEFAULT_REMINDER_OFFSET_MINUTES;
            if (userId) {
                const preferences = await preferenceService_1.preferenceService.getOrCreate(userId);
                offset = preferences.reminderOffsetMinutes ?? DEFAULT_REMINDER_OFFSET_MINUTES;
            }
            const remindAt = (0, date_1.addMinutes)(saved.dueDate, -offset);
            if (remindAt.getTime() > Date.now()) {
                await reminderService_1.reminderService.scheduleReminder(saved, remindAt, userId ?? undefined);
            }
        }
        return saved;
    }
}
exports.TaskService = TaskService;
exports.taskService = new TaskService();
//# sourceMappingURL=taskService.js.map