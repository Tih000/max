import type { Message as MaxMessage } from "@maxhub/max-bot-api/dist/core/network/api";
type ImportantMessageInfo = {
    isImportant: boolean;
    reason?: string;
    priority?: "high" | "medium" | "low";
};
export declare class ImportantMessageService {
    checkIfImportant(message: MaxMessage): Promise<ImportantMessageInfo>;
    notifyUsersAboutImportantMessage(message: MaxMessage, chatMembers: Array<{
        user_id: number;
    }>, botApi: {
        sendMessageToUser: (userId: number, text: string) => Promise<unknown>;
    }): Promise<void>;
}
export declare const importantMessageService: ImportantMessageService;
export {};
//# sourceMappingURL=importantMessageService.d.ts.map