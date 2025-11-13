import type { Message as MaxMessage } from "@maxhub/max-bot-api/dist/core/network/api";
export declare class TaskService {
    processIncomingMessage(message: MaxMessage, context?: string): Promise<{
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        dueDate: Date | null;
        title: string;
        description: string | null;
        assigneeId: string | null;
        assigneeName: string | null;
        sourceMessageId: string;
        createdByUserId: string | null;
        createdByName: string | null;
        priority: string;
    }[]>;
    getUpcomingTasks(chatId: number | string, until: Date): Promise<({
        reminders: {
            userId: string | null;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            taskId: string;
            remindAt: Date;
            delivered: boolean;
        }[];
    } & {
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        dueDate: Date | null;
        title: string;
        description: string | null;
        assigneeId: string | null;
        assigneeName: string | null;
        sourceMessageId: string;
        createdByUserId: string | null;
        createdByName: string | null;
        priority: string;
    })[]>;
    getPersonalTasks(userId: number | string, until: Date): Promise<({
        reminders: {
            userId: string | null;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            taskId: string;
            remindAt: Date;
            delivered: boolean;
        }[];
    } & {
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        dueDate: Date | null;
        title: string;
        description: string | null;
        assigneeId: string | null;
        assigneeName: string | null;
        sourceMessageId: string;
        createdByUserId: string | null;
        createdByName: string | null;
        priority: string;
    })[]>;
    getAllTasks(chatId: number | string, limit?: number): Promise<({
        reminders: {
            userId: string | null;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            taskId: string;
            remindAt: Date;
            delivered: boolean;
        }[];
    } & {
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: string;
        dueDate: Date | null;
        title: string;
        description: string | null;
        assigneeId: string | null;
        assigneeName: string | null;
        sourceMessageId: string;
        createdByUserId: string | null;
        createdByName: string | null;
        priority: string;
    })[]>;
    private mergeTasks;
    private createOrUpdateTask;
}
export declare const taskService: TaskService;
//# sourceMappingURL=taskService.d.ts.map