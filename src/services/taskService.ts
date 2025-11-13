import type { Message as MaxMessage } from "@maxhub/max-bot-api/dist/core/network/api";
import { prisma } from "../db";
import { logger } from "../logger";
import type { ParsedTask } from "../types";
import { addMinutes } from "../utils/date";
import { sanitizeText } from "../utils/text";
import { ensureIdString, toIdString } from "../utils/ids";
import { gigaChatService } from "./gigachatService";
import { preferenceService } from "./preferenceService";
import { reminderService } from "./reminderService";

const DEFAULT_REMINDER_OFFSET_MINUTES = 120;

export class TaskService {
  async processIncomingMessage(message: MaxMessage, context?: string) {
    const text = sanitizeText(message.body.text);
    if (!text) {
      return [];
    }

    const parsedTasks: ParsedTask[] = [];

    // Используем только LLM parser для точного определения дедлайнов
    // Heuristic parser отключен, так как он создает много ложных срабатываний
    if (!gigaChatService.enabled) {
      logger.debug("GigaChat не включен, задачи не извлекаются", {
        messageText: text.substring(0, 200),
        location: "processIncomingMessage",
      });
      return [];
    }
    
    try {
        // Получаем существующие задачи для предотвращения дубликатов
        const chatId = ensureIdString(message.recipient.chat_id);
        const existingTasks = await prisma.task.findMany({
          where: { chatId },
          select: { title: true, dueDate: true },
          take: 20,
        });

        // Формируем контекст из последних сообщений для лучшего понимания
        const recentMessages = await prisma.message.findMany({
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
          .map((msg) => `${msg.senderName ?? "Участник"}: ${sanitizeText(msg.text ?? "").substring(0, 200)}`)
          .join("\n");

        const llmTasks = await gigaChatService.extractTasks(
          text,
          contextMessages || context,
          existingTasks,
        );
        
        // Логируем результат извлечения задач (только если LOG_LEVEL=debug или если задач не найдено)
        if (process.env.LOG_LEVEL === "debug" || llmTasks.length === 0) {
          logger.debug("Извлечение задач из сообщения", {
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
      } catch (error) {
        logger.warn("Ошибка извлечения задач GigaChat", {
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

  async getUpcomingTasks(chatId: number | string, until: Date) {
    const normalizedChatId = ensureIdString(chatId);
    return prisma.task.findMany({
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

  async getPersonalTasks(userId: number | string, until: Date) {
    const normalizedUserId = ensureIdString(userId);
    return prisma.task.findMany({
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

  async getAllTasks(chatId: number | string, limit = 50) {
    const normalizedChatId = ensureIdString(chatId);
    return prisma.task.findMany({
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



  private mergeTasks(tasks: ParsedTask[]) {
    const map = new Map<string, ParsedTask>();

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

  private async createOrUpdateTask(task: ParsedTask, message: MaxMessage) {
    const chatId = ensureIdString(message.recipient.chat_id);
    const sourceMessageId = message.body.mid;

    const existing = await prisma.task.findFirst({
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
      assigneeId: toIdString(task.assigneeId) ?? undefined,
      assigneeName: task.assigneeName ?? undefined,
      sourceMessageId,
      createdByUserId: toIdString(message.sender?.user_id) ?? undefined,
      createdByName: message.sender?.name ?? undefined,
    };

    let saved;
    if (existing) {
      saved = await prisma.task.update({
        where: { id: existing.id },
        data,
      });
    } else {
      saved = await prisma.task.create({
        data,
      });
    }

    if (saved.dueDate) {
      const userId = saved.assigneeId ?? toIdString(message.sender?.user_id);
      let offset = DEFAULT_REMINDER_OFFSET_MINUTES;

      if (userId) {
        const preferences = await preferenceService.getOrCreate(userId);
        offset = preferences.reminderOffsetMinutes ?? DEFAULT_REMINDER_OFFSET_MINUTES;
      }

      const remindAt = addMinutes(saved.dueDate, -offset);
      if (remindAt.getTime() > Date.now()) {
        await reminderService.scheduleReminder(saved, remindAt, userId ?? undefined);
      }
    }

    return saved;
  }
}

export const taskService = new TaskService();

