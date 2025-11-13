"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userChatService = exports.UserChatService = void 0;
const db_1 = require("../db");
const logger_1 = require("../logger");
const ids_1 = require("../utils/ids");
class UserChatService {
    async getUserChats(userId) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        // @ts-ignore - UserChat model available after prisma:generate
        return db_1.prisma.userChat.findMany({
            where: {
                userId: normalizedUserId,
                isActive: true,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });
    }
    async addChat(userId, chatId, chatTitle) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        // @ts-ignore - UserChat model available after prisma:generate
        const existing = await db_1.prisma.userChat.findUnique({
            where: {
                userId_chatId: {
                    userId: normalizedUserId,
                    chatId: normalizedChatId,
                },
            },
        });
        if (existing) {
            // Reactivate if it was deactivated
            // @ts-ignore - UserChat model available after prisma:generate
            return db_1.prisma.userChat.update({
                where: { id: existing.id },
                data: {
                    isActive: true,
                    chatTitle: chatTitle ?? existing.chatTitle,
                    updatedAt: new Date(),
                },
            });
        }
        // @ts-ignore - UserChat model available after prisma:generate
        return db_1.prisma.userChat.create({
            data: {
                userId: normalizedUserId,
                chatId: normalizedChatId,
                chatTitle: chatTitle ?? undefined,
                isActive: true,
            },
        });
    }
    async removeChat(userId, chatId) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        // @ts-ignore - UserChat model available after prisma:generate
        const existing = await db_1.prisma.userChat.findUnique({
            where: {
                userId_chatId: {
                    userId: normalizedUserId,
                    chatId: normalizedChatId,
                },
            },
        });
        if (!existing) {
            return null;
        }
        // @ts-ignore - UserChat model available after prisma:generate
        return db_1.prisma.userChat.update({
            where: { id: existing.id },
            data: {
                isActive: false,
            },
        });
    }
    async selectChat(userId, chatId) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        // Verify chat exists in user's list
        // @ts-ignore - UserChat model available after prisma:generate
        const userChat = await db_1.prisma.userChat.findUnique({
            where: {
                userId_chatId: {
                    userId: normalizedUserId,
                    chatId: normalizedChatId,
                },
            },
        });
        if (!userChat || !userChat.isActive) {
            throw new Error("Чат не найден в вашем списке");
        }
        // Update preference
        // @ts-ignore - selectedChatId available after prisma:generate
        await db_1.prisma.userPreference.upsert({
            where: { userId: normalizedUserId },
            // @ts-ignore - selectedChatId available after prisma:generate
            update: { selectedChatId: normalizedChatId },
            // @ts-ignore - selectedChatId available after prisma:generate
            create: {
                userId: normalizedUserId,
                // @ts-ignore - selectedChatId available after prisma:generate
                selectedChatId: normalizedChatId,
            },
        });
        return userChat;
    }
    async getSelectedChat(userId) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        // @ts-ignore - selectedChatId available after prisma:generate
        const preference = await db_1.prisma.userPreference.findUnique({
            where: { userId: normalizedUserId },
            // @ts-ignore - selectedChatId available after prisma:generate
            select: { selectedChatId: true },
        });
        // @ts-ignore - selectedChatId available after prisma:generate
        if (!preference?.selectedChatId) {
            return null;
        }
        // Verify chat is still active
        // @ts-ignore - UserChat model available after prisma:generate
        const userChat = await db_1.prisma.userChat.findUnique({
            where: {
                userId_chatId: {
                    userId: normalizedUserId,
                    // @ts-ignore - selectedChatId available after prisma:generate
                    chatId: preference.selectedChatId,
                },
            },
        });
        if (!userChat || !userChat.isActive) {
            // Clear invalid selection
            // @ts-ignore - selectedChatId available after prisma:generate
            await db_1.prisma.userPreference.update({
                where: { userId: normalizedUserId },
                // @ts-ignore - selectedChatId available after prisma:generate
                data: { selectedChatId: null },
            });
            return null;
        }
        // @ts-ignore - selectedChatId available after prisma:generate
        return preference.selectedChatId;
    }
    async syncChatsFromMax(userId, botApi) {
        try {
            const response = await botApi.getAllChats();
            const allChats = response.chats ?? [];
            const normalizedUserId = (0, ids_1.ensureIdString)(userId);
            // Проверяем членство пользователя в каждом чате
            const userChats = [];
            for (const chat of allChats) {
                try {
                    // Проверяем, является ли пользователь участником чата
                    // Используем getChatMembers с user_ids для проверки конкретного пользователя
                    const membersResponse = await botApi.getChatMembers(chat.chat_id, [userId]);
                    const members = membersResponse.members ?? [];
                    // Если пользователь найден в списке участников, добавляем чат
                    if (members.some((member) => member.user_id === userId)) {
                        userChats.push(chat);
                    }
                }
                catch (error) {
                    // Если не удалось проверить членство (например, пользователь не в чате), пропускаем
                    // Пользователь не является участником чата - это нормально, не логируем
                }
            }
            // Get existing chats
            // @ts-ignore - UserChat model available after prisma:generate
            const existingChats = await db_1.prisma.userChat.findMany({
                where: {
                    userId: normalizedUserId,
                    isActive: true,
                },
            });
            const existingChatIds = new Set(existingChats.map((c) => c.chatId));
            // Add new chats (только те, в которых состоит пользователь)
            for (const chat of userChats) {
                const chatId = (0, ids_1.ensureIdString)(chat.chat_id);
                if (!existingChatIds.has(chatId)) {
                    await this.addChat(normalizedUserId, chatId, chat.title);
                }
                else {
                    // Update title if changed
                    // @ts-ignore - UserChat model available after prisma:generate
                    await db_1.prisma.userChat.updateMany({
                        where: {
                            userId: normalizedUserId,
                            chatId: chatId,
                        },
                        data: {
                            chatTitle: chat.title ?? undefined,
                        },
                    });
                }
            }
            return userChats.length;
        }
        catch (error) {
            logger_1.logger.error("Ошибка синхронизации чатов из MAX", { error, userId, location: "syncChatsFromMax" });
            throw error;
        }
    }
}
exports.UserChatService = UserChatService;
exports.userChatService = new UserChatService();
//# sourceMappingURL=userChatService.js.map