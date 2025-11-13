import type { Api } from "@maxhub/max-bot-api";
import { AssistantAnswer } from "../types";
export declare class AssistantService {
    private botApi?;
    setBotApi(api: Api): void;
    answerPersonalQuestion(userId: number, chatId: number | string | null, question: string, botApi?: Api): Promise<AssistantAnswer>;
    getWeeklyDigest(chatId: number | string): Promise<string>;
    private buildFallbackAnswer;
}
export declare const assistantService: AssistantService;
//# sourceMappingURL=assistantService.d.ts.map