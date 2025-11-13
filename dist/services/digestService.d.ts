import type { Api } from "@maxhub/max-bot-api";
import type { DigestOptions } from "../types";
export declare class DigestService {
    private botApi?;
    setBotApi(api: Api): void;
    generateDigest(chatId: number | string, chatTitle: string, range: {
        from: Date;
        to: Date;
    }, options?: DigestOptions, botApi?: Api): Promise<string>;
    saveDigest(chatId: string, range: {
        from: Date;
        to: Date;
    }, summary: string, createdBy: number | string | null): Promise<void>;
    getLastDigests(chatId: number | string, limit?: number): Promise<{
        chatId: string;
        id: string;
        createdAt: Date;
        summary: string;
        generatedFor: Date;
        from: Date;
        to: Date;
        createdBy: string | null;
    }[]>;
    /**
     * Добавляет или заменяет секцию материалов в дайджесте на правильно отформатированную версию
     * (как в разделе "Материалы")
     */
    private replaceMaterialsSection;
    private buildFallbackDigest;
}
export declare const digestService: DigestService;
//# sourceMappingURL=digestService.d.ts.map