"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchService = exports.SearchService = void 0;
const db_1 = require("../db");
const ids_1 = require("../utils/ids");
const text_1 = require("../utils/text");
class SearchService {
    async searchMaterials(chatId, query, limit = 20) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        const searchTerm = (0, text_1.sanitizeText)(query).toLowerCase();
        if (!searchTerm) {
            return [];
        }
        const allMaterials = await db_1.prisma.material.findMany({
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
        const seen = new Map();
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
    async searchMessages(chatId, query, limit = 20) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        const searchTerm = (0, text_1.sanitizeText)(query).toLowerCase();
        if (!searchTerm) {
            return [];
        }
        return db_1.prisma.message.findMany({
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
    async getAllMaterials(chatId, limit = 50) {
        const normalizedChatId = (0, ids_1.ensureIdString)(chatId);
        const allMaterials = await db_1.prisma.material.findMany({
            where: {
                chatId: normalizedChatId,
            },
            orderBy: {
                createdAt: "desc",
            },
            take: limit * 2, // Берем больше, чтобы после дедупликации осталось достаточно
        });
        // Дедупликация: убираем материалы с одинаковой ссылкой или одинаковым названием+ссылкой
        const seen = new Map();
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
exports.SearchService = SearchService;
exports.searchService = new SearchService();
//# sourceMappingURL=searchService.js.map