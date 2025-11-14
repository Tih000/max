import schedule, { Job } from "node-schedule";
import type { Reminder, Task } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { toInt } from "../utils/number";

export type ReminderHandler = (task: Task, reminder: Reminder) => Promise<void>;

const JOB_OFFSET_MS = 5_000;

export class ReminderService {
  private handler?: ReminderHandler;

  private jobs = new Map<string, Job>();

  async init(handler: ReminderHandler) {
    this.handler = handler;
    await this.restorePendingReminders();
  }

  async scheduleReminder(task: Task, remindAt: Date, userId?: number | string) {
    const reminder = await prisma.reminder.create({
      data: {
        taskId: task.id,
        userId: toInt(userId) ?? undefined,
        remindAt,
      },
    });

    this.scheduleJob(reminder, task);
    return reminder;
  }

  async markDelivered(reminderId: string) {
    await prisma.reminder.update({
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

  private async restorePendingReminders() {
    const reminders: Array<Reminder & { task: Task }> = await prisma.reminder.findMany({
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

  private scheduleJob(reminder: Reminder, task: Task) {
    const existing = this.jobs.get(reminder.id);
    if (existing) {
      existing.cancel();
    }

    const runAt = reminder.remindAt;
    if (runAt.getTime() <= Date.now() + JOB_OFFSET_MS) {
      void this.triggerReminder(reminder, task);
      return;
    }

    const job = schedule.scheduleJob(runAt, () => {
      void this.triggerReminder(reminder, task);
    });

    this.jobs.set(reminder.id, job);
  }

  private async triggerReminder(reminder: Reminder, task: Task) {
    if (!this.handler) {
      logger.error("Reminder handler is not configured");
      return;
    }

    try {
      await this.handler(task, reminder);
      await this.markDelivered(reminder.id);
    } catch (error) {
      logger.error("Ошибка обработки напоминания", { error, location: "processReminder" });
    }
  }
}

export const reminderService = new ReminderService();

