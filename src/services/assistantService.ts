import type { Material, Message as PrismaMessage } from "@prisma/client";
import type { Api } from "@maxhub/max-bot-api";
import { prisma } from "../db";
import { logger } from "../logger";
import { AssistantAnswer } from "../types";
import { formatDate, startOfWeek, endOfWeek, addDays } from "../utils/date";
import { formatBulletList, sanitizeText } from "../utils/text";
import { gigaChatService } from "./gigachatService";
import { preferenceService } from "./preferenceService";
import { taskService } from "./taskService";
import { toInt, toBigInt } from "../utils/number";

type TaskWithReminders = Awaited<ReturnType<typeof taskService.getPersonalTasks>>[number];

export class AssistantService {
  private botApi?: Api;

  setBotApi(api: Api) {
    this.botApi = api;
  }

  async answerPersonalQuestion(
    userId: number,
    chatId: number | string | null,
    question: string,
    botApi?: Api,
  ): Promise<AssistantAnswer> {
    const userIdNumber = toInt(userId);
    if (!userIdNumber) {
      throw new Error("Не удалось определить ID пользователя");
    }
    const timezone = (await preferenceService.getOrCreate(userIdNumber)).timezone;
    const normalizedChatId = chatId ? toBigInt(chatId) : null;
    const api = botApi ?? this.botApi;

    // Получаем расширенный контекст с историей чата
    const [upcomingTasks, allTasks, materials, recentMessages, chatMembers] = await Promise.all([
      taskService.getPersonalTasks(userIdNumber, addDays(new Date(), 7)),
      normalizedChatId ? taskService.getAllTasks(normalizedChatId, 30) : Promise.resolve([]),
      normalizedChatId
        ? prisma.material.findMany({
            where: { chatId: normalizedChatId },
            orderBy: { createdAt: "desc" },
            take: 20,
            distinct: ["link"],
          })
        : Promise.resolve([]),
      normalizedChatId
        ? prisma.message.findMany({
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
              const numericChatId = toInt(chatId);
              if (numericChatId) {
                const response = await api.getChatMembers(numericChatId);
                return response.members ?? [];
              }
            } catch (error) {
              logger.warn("Не удалось получить участников чата", { error, chatId });
            }
            return [];
          })()
        : Promise.resolve([]),
    ]);

    const now = new Date();
    const contextParts: string[] = [];

    // Базовая информация
    contextParts.push(`Текущая дата и время: ${formatDate(now, timezone)}`);
    contextParts.push(`Таймзона: ${timezone}`);

    // Участники чата и их роли
    if (chatMembers.length > 0) {
      // Анализируем активность участников
      const memberActivity = new Map<string, { name: string; username?: string; messageCount: number; lastActivity?: Date }>();
      
      recentMessages.forEach((msg) => {
        const senderId = msg.senderId ? String(msg.senderId) : "unknown";
        const existing = memberActivity.get(senderId);
        memberActivity.set(senderId, {
          name: msg.senderName ?? existing?.name ?? "Участник",
          username: msg.senderUsername ?? existing?.username,
          messageCount: (existing?.messageCount ?? 0) + 1,
          lastActivity:
            existing?.lastActivity && msg.timestamp.getTime() > existing.lastActivity.getTime()
              ? msg.timestamp
              : existing?.lastActivity ?? msg.timestamp,
        });
      });

      // Объединяем с информацией из API
      const membersInfo = chatMembers.map((member: { user_id?: number; name?: string; username?: string | null }) => {
        const userId = member.user_id ? String(member.user_id) : "unknown";
        const activity = memberActivity.get(userId);
        return {
          id: member.user_id ?? 0,
          name: member.name ?? activity?.name ?? "Участник",
          username: member.username ?? activity?.username ?? undefined,
          messageCount: activity?.messageCount ?? 0,
          lastActivity: activity?.lastActivity,
        };
      });

      // Сортируем по активности
      membersInfo.sort((a, b) => b.messageCount - a.messageCount);

      contextParts.push(
        "",
        `=== УЧАСТНИКИ ЧАТА (${membersInfo.length}) ===`,
        formatBulletList(
          membersInfo.slice(0, 20).map((member) => {
            const parts = [member.name];
            if (member.username) parts.push(`@${member.username}`);
            if (member.messageCount > 0) {
              parts.push(`сообщений: ${member.messageCount}`);
            }
            if (member.lastActivity) {
              const daysAgo = Math.floor((now.getTime() - member.lastActivity.getTime()) / (1000 * 60 * 60 * 24));
              if (daysAgo === 0) parts.push("активен сегодня");
              else if (daysAgo === 1) parts.push("активен вчера");
              else parts.push(`активен ${daysAgo} дн. назад`);
            }
            return parts.join(" | ");
          }),
        ),
      );
    }

    // Ближайшие задачи пользователя
    if (upcomingTasks.length > 0) {
      contextParts.push(
        "=== МОИ БЛИЖАЙШИЕ ЗАДАЧИ (на неделю) ===",
        formatBulletList(
          upcomingTasks.map((task: TaskWithReminders) => {
            const parts = [task.title];
            if (task.dueDate) {
              const daysLeft = Math.ceil((task.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              parts.push(`дедлайн: ${formatDate(task.dueDate, timezone)} (через ${daysLeft} дн.)`);
            }
            if (task.assigneeName) parts.push(`ответственный: ${task.assigneeName}`);
            if (task.description) parts.push(`описание: ${task.description}`);
            return parts.join(" | ");
          }),
        ),
      );
    } else {
      contextParts.push("=== МОИ БЛИЖАЙШИЕ ЗАДАЧИ ===", "Нет задач на ближайшую неделю.");
    }

    // Все задачи в чате
    if (allTasks.length > 0) {
      contextParts.push(
        "",
        `=== ВСЕ ЗАДАЧИ В ЧАТЕ (${allTasks.length}) ===`,
        formatBulletList(
          allTasks.slice(0, 15).map((task) => {
            const parts = [task.title];
            if (task.dueDate) parts.push(`дедлайн: ${formatDate(task.dueDate, timezone)}`);
            if (task.assigneeName) parts.push(`ответственный: ${task.assigneeName}`);
            return parts.join(" | ");
          }),
        ),
      );
    }

    // Материалы
    if (materials.length > 0) {
      contextParts.push(
        "",
        `=== МАТЕРИАЛЫ ИЗ ЧАТА (${materials.length}) ===`,
        formatBulletList(
          materials.map((material: Material) => {
            if (material.link) {
              return `${material.title}\n   Ссылка: ${material.link}`;
            }
            return material.title;
          }),
        ),
      );
    }

    // Полная история сообщений из чата (контекст обсуждений)
    if (recentMessages.length > 0) {
      contextParts.push(
        "",
        `=== ИСТОРИЯ ЧАТА (последние ${recentMessages.length} сообщений) ===`,
        recentMessages
          .reverse()
          .map((msg, index) => {
            const author = msg.senderName ?? msg.senderUsername ?? "Участник";
            const time = formatDate(msg.timestamp, timezone);
            const text = sanitizeText(msg.text ?? "");
            // Для первых и последних сообщений показываем больше текста
            const maxLength = index < 5 || index >= recentMessages.length - 5 ? 300 : 150;
            const truncated = text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
            return `[${time}] ${author}: ${truncated}`;
          })
          .join("\n"),
      );
    }

    const context = contextParts.join("\n\n");

    if (gigaChatService.enabled) {
      try {
        const answer = await gigaChatService.answerQuestion(question, context, {
          chatId: normalizedChatId ? String(normalizedChatId) : null,
          userId: String(userIdNumber),
          timezone,
          chatMembers: chatMembers.map((m: { user_id?: number; name?: string; username?: string | null }) => ({
            id: String(m.user_id ?? 0),
            name: m.name ?? "Участник",
            username: m.username ?? undefined,
          })),
        });
        return {
          title: "Ответ ассистента",
          body: answer,
        };
      } catch (error) {
        logger.error("Ошибка ответа GigaChat", { error, location: "answerPersonalQuestion" });
      }
    }

    return {
      title: "Ответ ассистента (ограниченный режим)",
      body: this.buildFallbackAnswer(question, context),
    };
  }

  async getWeeklyDigest(chatId: number | string | bigint) {
    const from = startOfWeek();
    const to = endOfWeek();
    const messages: PrismaMessage[] = await prisma.message.findMany({
      where: {
        chatId: toBigInt(chatId) ?? undefined,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: "asc" },
    });

    return formatBulletList(
      messages
        .slice(-5)
        .map((message: PrismaMessage) => `${message.senderName ?? "Участник"}: ${sanitizeText(message.text)}`),
    );
  }

  private buildFallbackAnswer(question: string, context: string) {
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

export const assistantService = new AssistantService();

