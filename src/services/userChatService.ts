import { prisma } from "../db";
import { logger } from "../logger";
import { toInt, toBigInt } from "../utils/number";

export class UserChatService {
  async getUserChats(userId: number | string) {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) return [];
    return prisma.userChat.findMany({
      where: {
        userId: normalizedUserId,
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  async addChat(userId: number | string, chatId: number | string, chatTitle?: string) {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) return;
    const normalizedChatId = toBigInt(chatId);
    if (!normalizedChatId) return;

    const existing = await prisma.userChat.findUnique({
      where: {
        userId_chatId: {
          userId: normalizedUserId,
          chatId: normalizedChatId,
        },
      },
    });

    if (existing) {
      // Reactivate if it was deactivated
      return prisma.userChat.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          chatTitle: chatTitle ?? existing.chatTitle,
          updatedAt: new Date(),
        },
      });
    }

    return prisma.userChat.create({
      data: {
        userId: normalizedUserId,
        chatId: normalizedChatId,
        chatTitle: chatTitle ?? undefined,
        isActive: true,
      },
    });
  }

  async removeChat(userId: number | string, chatId: number | string) {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) return;
    const normalizedChatId = toBigInt(chatId);
    if (!normalizedChatId) return;

    const existing = await prisma.userChat.findUnique({
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

    return prisma.userChat.update({
      where: { id: existing.id },
      data: {
        isActive: false,
      },
    });
  }

  async selectChat(userId: number | string, chatId: number | string) {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) return;
    const normalizedChatId = toBigInt(chatId);
    if (!normalizedChatId) return;

    // Verify chat exists in user's list
    const userChat = await prisma.userChat.findUnique({
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
    await prisma.userPreference.upsert({
      where: { userId: normalizedUserId },
        update: { selectedChatId: normalizedChatId },
        create: {
        userId: normalizedUserId,
        selectedChatId: normalizedChatId,
      },
    });

    return userChat;
  }

  async getSelectedChat(userId: number | string): Promise<bigint | null> {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) return null;
    const preference = await prisma.userPreference.findUnique({
      where: { userId: normalizedUserId },
      select: { selectedChatId: true },
    });

    if (!preference?.selectedChatId) {
      return null;
    }

    // Verify chat is still active
    const userChat = await prisma.userChat.findUnique({
      where: {
        userId_chatId: {
          userId: normalizedUserId,
          chatId: preference.selectedChatId,
        },
      },
    });

    if (!userChat || !userChat.isActive) {
      // Clear invalid selection
      await prisma.userPreference.update({
        where: { userId: normalizedUserId },
        data: { selectedChatId: null },
      });
      return null;
    }

    return preference.selectedChatId;
  }

  async syncChatsFromMax(
    userId: number,
    botApi: {
      getAllChats: () => Promise<{ chats?: Array<{ chat_id: number; title?: string }> }>;
      getChatMembers: (chatId: number, user_ids: number[]) => Promise<{ members?: Array<{ user_id: number }> }>;
    },
  ) {
    try {
      const response = await botApi.getAllChats();
      const allChats = response.chats ?? [];

      const normalizedUserId = toInt(userId);
    if (!normalizedUserId) return;

      // Проверяем членство пользователя в каждом чате
      const userChats: Array<{ chat_id: number; title?: string }> = [];
      
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
        } catch (error) {
          // Если не удалось проверить членство (например, пользователь не в чате), пропускаем
          // Пользователь не является участником чата - это нормально, не логируем
        }
      }

      // Get existing chats
    const existingChats = await prisma.userChat.findMany({
      where: {
        userId: normalizedUserId,
        isActive: true,
      },
    });

    const existingChatIds = new Set(existingChats.map((c) => c.chatId));

      // Add new chats (только те, в которых состоит пользователь)
      for (const chat of userChats) {
        const chatId = toBigInt(chat.chat_id);
        if (!chatId) continue;
        if (!existingChatIds.has(chatId)) {
          await this.addChat(normalizedUserId, Number(chatId), chat.title);
        } else {
          // Update title if changed
          await prisma.userChat.updateMany({
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
    } catch (error) {
      logger.error("Ошибка синхронизации чатов из MAX", { error, userId, location: "syncChatsFromMax" });
      throw error;
    }
  }
}

export const userChatService = new UserChatService();

