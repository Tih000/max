export declare class SearchService {
    searchMaterials(chatId: number | string, query: string, limit?: number): Promise<{
        type: string | null;
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        link: string | null;
        title: string;
        description: string | null;
        messageId: string;
        fileType: string | null;
        fileName: string | null;
    }[]>;
    searchMessages(chatId: number | string, query: string, limit?: number): Promise<{
        id: string;
        senderName: string | null;
        senderUsername: string | null;
        text: string | null;
        attachments: import("@prisma/client/runtime/library").JsonValue;
        timestamp: Date;
    }[]>;
    getAllMaterials(chatId: number | string, limit?: number): Promise<{
        type: string | null;
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        link: string | null;
        title: string;
        description: string | null;
        messageId: string;
        fileType: string | null;
        fileName: string | null;
    }[]>;
}
export declare const searchService: SearchService;
//# sourceMappingURL=searchService.d.ts.map