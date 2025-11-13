"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledDigestService = exports.ScheduledDigestService = void 0;
const node_schedule_1 = __importDefault(require("node-schedule"));
const db_1 = require("../db");
const logger_1 = require("../logger");
const digestService_1 = require("./digestService");
const ids_1 = require("../utils/ids");
const number_1 = require("../utils/number");
const date_1 = require("../utils/date");
class ScheduledDigestService {
    jobs = new Map();
    botApi;
    async init(botApi) {
        this.botApi = botApi;
        // Schedule daily digests for all users with preferences
        await this.restoreScheduledDigests(botApi);
        // Schedule a job to check for new scheduled digests every hour
        node_schedule_1.default.scheduleJob("0 * * * *", async () => {
            await this.restoreScheduledDigests(botApi);
        });
    }
    async scheduleDigest(chatId, userId, cronExpression, botApi) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const key = `${normalizedChatId}:${normalizedUserId}`;
        // Cancel existing job if any
        const existing = this.jobs.get(key);
        if (existing) {
            existing.job.cancel();
        }
        const api = botApi ?? this.botApi;
        const job = node_schedule_1.default.scheduleJob(cronExpression, async () => {
            try {
                const from = (0, date_1.startOfDay)();
                const to = (0, date_1.endOfDay)();
                const chatTitle = "Чат"; // Could be fetched from chat info
                const summary = await digestService_1.digestService.generateDigest(normalizedChatId, chatTitle, { from, to }, {}, this.botApi);
                const numericUserId = (0, number_1.toInt)(normalizedUserId);
                if (numericUserId && api) {
                    await api.sendMessageToUser(numericUserId, [`📊 Ежедневный дайджест за ${from.toLocaleDateString("ru-RU")}:`, summary].join("\n\n"));
                }
            }
            catch (error) {
                logger_1.logger.error("Ошибка отправки запланированного дайджеста", { error, chatId: normalizedChatId, userId: normalizedUserId, location: "scheduleDigest" });
            }
        });
        if (job) {
            this.jobs.set(key, { chatId: normalizedChatId, userId: normalizedUserId, job });
        }
    }
    async cancelDigest(chatId, userId) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const key = `${normalizedChatId}:${normalizedUserId}`;
        const existing = this.jobs.get(key);
        if (existing) {
            existing.job.cancel();
            this.jobs.delete(key);
        }
    }
    async restoreScheduledDigests(_botApi) {
        // This is a simplified version - in production, you'd track which chats users want digests for
        // For now, we'll just check user preferences and schedule daily digests at 9 AM
        try {
            const users = await db_1.prisma.userPreference.findMany({
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
                    logger_1.logger.debug(`Запланированный дайджест будет настроен для пользователя ${user.userId}`, { userId: user.userId });
                }
            }
        }
        catch (error) {
            logger_1.logger.warn("Не удалось восстановить запланированные дайджесты, продолжаем без них", { error, location: "restoreScheduledDigests" });
        }
    }
}
exports.ScheduledDigestService = ScheduledDigestService;
exports.scheduledDigestService = new ScheduledDigestService();
//# sourceMappingURL=scheduledDigestService.js.map