import type { Api } from "@maxhub/max-bot-api";
export declare class ScheduledDigestService {
    private jobs;
    private botApi?;
    init(botApi: Api): Promise<void>;
    scheduleDigest(chatId: number | string, userId: number | string, cronExpression: string, botApi?: {
        sendMessageToUser: (userId: number, text: string) => Promise<unknown>;
    }): Promise<void>;
    cancelDigest(chatId: number | string, userId: number | string): Promise<void>;
    private restoreScheduledDigests;
}
export declare const scheduledDigestService: ScheduledDigestService;
//# sourceMappingURL=scheduledDigestService.d.ts.map