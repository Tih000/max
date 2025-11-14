import { prisma } from "../db";
import { toBigInt } from "../utils/number";
import { sanitizeText } from "../utils/text";

type Material = Awaited<ReturnType<typeof prisma.material.findMany>>[number];

export class SearchService {
  async searchMaterials(chatId: number | string | bigint, query: string, limit = 20) {
    const normalizedChatId = toBigInt(chatId);
    if (!normalizedChatId) return [];
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
      take: limit * 2, 
    });

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

  async searchMessages(chatId: number | string | bigint, query: string, limit = 20) {
    const normalizedChatId = toBigInt(chatId);
    if (!normalizedChatId) return [];
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
    const normalizedChatId = toBigInt(chatId);
    if (!normalizedChatId) return [];
    const allMaterials = await prisma.material.findMany({
      where: {
        chatId: normalizedChatId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit * 2,
    });

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
}

export const searchService = new SearchService();

