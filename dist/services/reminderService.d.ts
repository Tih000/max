import type { Reminder, Task } from "@prisma/client";
export type ReminderHandler = (task: Task, reminder: Reminder) => Promise<void>;
export declare class ReminderService {
    private handler?;
    private jobs;
    init(handler: ReminderHandler): Promise<void>;
    scheduleReminder(task: Task, remindAt: Date, userId?: number | string): Promise<{
        userId: string | null;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        taskId: string;
        remindAt: Date;
        delivered: boolean;
    }>;
    markDelivered(reminderId: string): Promise<void>;
    private restorePendingReminders;
    private scheduleJob;
    private triggerReminder;
}
export declare const reminderService: ReminderService;
//# sourceMappingURL=reminderService.d.ts.map