import type { Api } from "@maxhub/max-bot-api";
import schedule, { Job } from "node-schedule";
import { prisma } from "../db";
import { logger } from "../logger";
import { digestService } from "./digestService";
import { toInt, toBigInt } from "../utils/number";
import { endOfDay, startOfDay } from "../utils/date";

type DigestJob = {
  chatId: bigint;
  userId: number;
  job: Job;
};

export class ScheduledDigestService {
  private jobs = new Map<string, DigestJob>();
  private botApi?: Api;

  async init(botApi: Api) {
    this.botApi = botApi;
    // Schedule daily digests for all users with preferences
    await this.restoreScheduledDigests(botApi);

    // Schedule a job to check for new scheduled digests every hour
    schedule.scheduleJob("0 * * * *", async () => {
      await this.restoreScheduledDigests(botApi);
    });
  }

  async scheduleDigest(
    chatId: number | string,
    userId: number | string,
    cronExpression: string,
    botApi?: { sendMessageToUser: (userId: number, text: string) => Promise<unknown> },
  ) {
    const normalizedChatId = toBigInt(chatId);
    const normalizedUserId = toInt(userId);
    if (!normalizedChatId || !normalizedUserId) return;
    const key = `${normalizedChatId}:${normalizedUserId}`;

    // Cancel existing job if any
    const existing = this.jobs.get(key);
    if (existing) {
      existing.job.cancel();
    }

    const api = botApi ?? this.botApi;
    const job = schedule.scheduleJob(cronExpression, async () => {
      try {
        const from = startOfDay();
        const to = endOfDay();
        const chatTitle = "Чат"; // Could be fetched from chat info
        const summary = await digestService.generateDigest(normalizedChatId, chatTitle, { from, to }, {}, this.botApi);

        const numericUserId = toInt(normalizedUserId);
        if (numericUserId && api) {
          await api.sendMessageToUser(
            numericUserId,
            [`📊 Ежедневный дайджест за ${from.toLocaleDateString("ru-RU")}:`, summary].join("\n\n"),
          );
        }
      } catch (error) {
        logger.error("Ошибка отправки запланированного дайджеста", { error, chatId: normalizedChatId, userId: normalizedUserId, location: "scheduleDigest" });
      }
    });

    if (job) {
      this.jobs.set(key, { chatId: normalizedChatId, userId: normalizedUserId, job });
    }
  }

  async cancelDigest(chatId: number | string, userId: number | string) {
    const normalizedChatId = toBigInt(chatId);
    const normalizedUserId = toInt(userId);
    if (!normalizedChatId || !normalizedUserId) return;
    const key = `${normalizedChatId}:${normalizedUserId}`;

    const existing = this.jobs.get(key);
    if (existing) {
      existing.job.cancel();
      this.jobs.delete(key);
    }
  }

  private async restoreScheduledDigests(_botApi: { sendMessageToUser: (userId: number, text: string) => Promise<unknown> }) {
    // This is a simplified version - in production, you'd track which chats users want digests for
    // For now, we'll just check user preferences and schedule daily digests at 9 AM
    try {
      const users = await prisma.userPreference.findMany({
        where: {
          digestScheduleCron: {
            not: null,
          },
        },
        // @ts-ignore - selectedChatId available after prisma:generate
        select: {
          userId: true,
          digestScheduleCron: true,
        },
      });

      for (const user of users) {
        if (user.digestScheduleCron) {
          // In a real implementation, you'd need to track which chats the user wants digests for
          // For now, this is a placeholder
          logger.debug(`Запланированный дайджест будет настроен для пользователя ${user.userId}`, { userId: user.userId });
        }
      }
    } catch (error) {
      logger.warn("Не удалось восстановить запланированные дайджесты, продолжаем без них", { error, location: "restoreScheduledDigests" });
    }
  }
}

export const scheduledDigestService = new ScheduledDigestService();

