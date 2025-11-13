import { DigestOptions, ParsedTask } from "../types";
export declare class GigaChatService {
    private readonly authClient;
    private readonly apiClient;
    private tokenCache;
    readonly enabled: boolean;
    constructor();
    private createHttpsAgent;
    private getAccessToken;
    private complete;
    summarizeChat(chatTitle: string, preparedMessages: string, range: {
        from: Date;
        to: Date;
    }, options?: DigestOptions, chatMembers?: Array<{
        id: string;
        name: string;
        username?: string;
        messageCount?: number;
    }>, _materials?: Array<{
        title: string;
        link?: string | null;
        description?: string | null;
    }>): Promise<string>;
    extractTasks(messageText: string, context?: string, existingTasks?: Array<{
        title: string;
        dueDate?: Date | null;
    }>): Promise<ParsedTask[]>;
    /**
     * Анализирует материал и создает краткую сводку через ИИ
     * @param material - Информация о материале
     * @param context - Контекст сообщения или чата
     * @returns Краткая сводка материала или null, если анализ невозможен
     */
    analyzeMaterial(material: {
        title: string;
        type?: "image" | "file" | "video" | "share";
        fileName?: string;
        fileType?: string;
        link?: string;
    }, context?: string): Promise<string | null>;
    answerQuestion(question: string, context: string, options?: {
        chatId?: string | null;
        userId?: string;
        timezone?: string;
        chatMembers?: Array<{
            id: string;
            name: string;
            username?: string;
        }>;
    }): Promise<string>;
    checkMessageImportance(messageText: string): Promise<boolean>;
}
export declare const gigaChatService: GigaChatService;
//# sourceMappingURL=gigachatService.d.ts.map