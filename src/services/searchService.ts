import type { Material } from "@prisma/client";
import { prisma } from "../db";
import { ensureIdString } from "../utils/ids";
import { sanitizeText } from "../utils/text";

export class SearchService {
  async searchMaterials(chatId: number | string, query: string, limit = 20) {
    const normalizedChatId = ensureIdString(chatId);
    const searchTerm = sanitizeText(query).toLowerCase();

    if (!searchTerm) {
      return [];
    }

    const allMaterials: Material[] = await prisma.material.findMany({
      where: {
        chatId: normalizedChatId,
        OR: [
          { title: { contains: searchTerm, mode: "insensitive" } },
          { link: { contains: searchTerm, mode: "insensitive" } },
        ],
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit * 2, // Берем больше для дедупликации
    });

    // Дедупликация: убираем материалы с одинаковой ссылкой
    const seen = new Map<string, Material>();
    
    for (const material of allMaterials) {
      const key = material.link 
        ? material.link.toLowerCase().trim()
        : (material.title?.toLowerCase().trim() ?? "");
      
      if (key && !seen.has(key)) {
        seen.set(key, material);
      }
    }

    return Array.from(seen.values()).slice(0, limit);
  }

  async searchMessages(chatId: number | string, query: string, limit = 20) {
    const normalizedChatId = ensureIdString(chatId);
    const searchTerm = sanitizeText(query).toLowerCase();

    if (!searchTerm) {
      return [];
    }

    return prisma.message.findMany({
      where: {
        chatId: normalizedChatId,
        text: {
          contains: searchTerm,
          mode: "insensitive",
        },
      },
      orderBy: {
        timestamp: "desc",
      },
      take: limit,
      select: {
        id: true,
        text: true,
        senderName: true,
        senderUsername: true,
        timestamp: true,
        attachments: true,
      },
    });
  }

  async getAllMaterials(chatId: number | string, limit = 50) {
    const normalizedChatId = ensureIdString(chatId);
    const allMaterials = await prisma.material.findMany({
      where: {
        chatId: normalizedChatId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit * 2, // Берем больше, чтобы после дедупликации осталось достаточно
    });

    // Дедупликация: убираем материалы с одинаковой ссылкой или одинаковым названием+ссылкой
    const seen = new Map<string, Material>();
    
    for (const material of allMaterials) {
      // Используем ссылку как основной ключ для дедупликации
      const key = material.link 
        ? material.link.toLowerCase().trim()
        : (material.title?.toLowerCase().trim() ?? "");
      
      // Если материала с такой ссылкой/названием еще нет, добавляем
      // Приоритет отдаем более новым материалам (они идут первыми из-за orderBy)
      if (key && !seen.has(key)) {
        seen.set(key, material);
      }
    }

    // Возвращаем уникальные материалы, ограничивая количество
    return Array.from(seen.values()).slice(0, limit);
  }
}

export const searchService = new SearchService();

