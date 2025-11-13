"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reminderService = exports.ReminderService = void 0;
const node_schedule_1 = __importDefault(require("node-schedule"));
const db_1 = require("../db");
const logger_1 = require("../logger");
const ids_1 = require("../utils/ids");
const JOB_OFFSET_MS = 5_000;
class ReminderService {
    handler;
    jobs = new Map();
    async init(handler) {
        this.handler = handler;
        await this.restorePendingReminders();
    }
    async scheduleReminder(task, remindAt, userId) {
        const reminder = await db_1.prisma.reminder.create({
            data: {
                taskId: task.id,
                userId: (0, ids_1.toIdString)(userId) ?? undefined,
                remindAt,
            },
        });
        this.scheduleJob(reminder, task);
        return reminder;
    }
    async markDelivered(reminderId) {
        await db_1.prisma.reminder.update({
            where: { id: reminderId },
            data: {
                delivered: true,
            },
        });
        const job = this.jobs.get(reminderId);
        if (job) {
            job.cancel();
            this.jobs.delete(reminderId);
        }
    }
    async restorePendingReminders() {
        const reminders = await db_1.prisma.reminder.findMany({
            where: {
                delivered: false,
                remindAt: {
                    gte: new Date(Date.now() - JOB_OFFSET_MS),
                },
            },
            include: {
                task: true,
            },
        });
        reminders.forEach(({ task, ...reminder }) => {
            this.scheduleJob(reminder, task);
        });
    }
    scheduleJob(reminder, task) {
        const existing = this.jobs.get(reminder.id);
        if (existing) {
            existing.cancel();
        }
        const runAt = reminder.remindAt;
        if (runAt.getTime() <= Date.now() + JOB_OFFSET_MS) {
            void this.triggerReminder(reminder, task);
            return;
        }
        const job = node_schedule_1.default.scheduleJob(runAt, () => {
            void this.triggerReminder(reminder, task);
        });
        this.jobs.set(reminder.id, job);
    }
    async triggerReminder(reminder, task) {
        if (!this.handler) {
            logger_1.logger.error("Reminder handler is not configured");
            return;
        }
        try {
            await this.handler(task, reminder);
            await this.markDelivered(reminder.id);
        }
        catch (error) {
            logger_1.logger.error("Ошибка обработки напоминания", { error, location: "processReminder" });
        }
    }
}
exports.ReminderService = ReminderService;
exports.reminderService = new ReminderService();
//# sourceMappingURL=reminderService.js.map