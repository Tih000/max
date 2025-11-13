export declare class UserChatService {
    getUserChats(userId: number | string): Promise<{
        userId: string;
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        chatTitle: string | null;
        isActive: boolean;
    }[]>;
    addChat(userId: number | string, chatId: number | string, chatTitle?: string): Promise<{
        userId: string;
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        chatTitle: string | null;
        isActive: boolean;
    }>;
    removeChat(userId: number | string, chatId: number | string): Promise<{
        userId: string;
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        chatTitle: string | null;
        isActive: boolean;
    } | null>;
    selectChat(userId: number | string, chatId: number | string): Promise<{
        userId: string;
        chatId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        chatTitle: string | null;
        isActive: boolean;
    }>;
    getSelectedChat(userId: number | string): Promise<string | null>;
    syncChatsFromMax(userId: number, botApi: {
        getAllChats: () => Promise<{
            chats?: Array<{
                chat_id: number;
                title?: string;
            }>;
        }>;
        getChatMembers: (chatId: number, user_ids: number[]) => Promise<{
            members?: Array<{
                user_id: number;
            }>;
        }>;
    }): Promise<number>;
}
export declare const userChatService: UserChatService;
//# sourceMappingURL=userChatService.d.ts.map