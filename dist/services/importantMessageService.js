"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importantMessageService = exports.ImportantMessageService = void 0;
const logger_1 = require("../logger");
const gigachatService_1 = require("./gigachatService");
const number_1 = require("../utils/number");
const text_1 = require("../utils/text");
class ImportantMessageService {
    async checkIfImportant(message) {
        const text = (0, text_1.sanitizeText)(message.body.text);
        if (!text) {
            return { isImportant: false };
        }
        // Heuristic checks
        const hasDeadlineKeywords = /дедлайн|deadline|срок|до|когда|к\s+\d+|завтра|сегодня/i.test(text);
        const hasTaskKeywords = /задача|task|сделать|нужно|требуется|поручение/i.test(text);
        const hasAssignmentKeywords = /@\w+|ответственный|назначить|поручил/i.test(text);
        const hasUrgentKeywords = /срочно|urgent|важно|important|критично/i.test(text);
        const hasQuestion = text.includes("?");
        const mentionsUser = /@\w+/i.test(text);
        const heuristicScore = (hasDeadlineKeywords ? 2 : 0) +
            (hasTaskKeywords ? 2 : 0) +
            (hasAssignmentKeywords ? 2 : 0) +
            (hasUrgentKeywords ? 3 : 0) +
            (hasQuestion ? 1 : 0) +
            (mentionsUser ? 1 : 0);
        if (heuristicScore >= 3) {
            const reasons = [];
            if (hasDeadlineKeywords)
                reasons.push("дедлайн");
            if (hasTaskKeywords)
                reasons.push("задача");
            if (hasUrgentKeywords)
                reasons.push("срочно");
            if (hasAssignmentKeywords)
                reasons.push("назначение");
            return {
                isImportant: true,
                reason: reasons.join(", "),
                priority: heuristicScore >= 5 ? "high" : heuristicScore >= 3 ? "medium" : "low",
            };
        }
        // LLM check if enabled
        if (gigachatService_1.gigaChatService.enabled) {
            try {
                const isImportant = await gigachatService_1.gigaChatService.checkMessageImportance(text);
                if (isImportant) {
                    return {
                        isImportant: true,
                        reason: "важное сообщение",
                        priority: "medium",
                    };
                }
            }
            catch (error) {
                logger_1.logger.warn("Ошибка проверки важности сообщения GigaChat", { error, location: "checkIfImportant" });
            }
        }
        return { isImportant: false };
    }
    async notifyUsersAboutImportantMessage(message, chatMembers, botApi) {
        const text = (0, text_1.sanitizeText)(message.body.text) ?? "";
        const senderName = message.sender?.name ?? "Участник";
        const chatTitle = message.recipient.chat_title ?? "Чат";
        const notificationText = [
            `🔔 Важное сообщение из чата «${chatTitle}»:`,
            "",
            `${senderName}:`,
            text.length > 300 ? `${text.substring(0, 300)}...` : text,
            "",
            `Чат: ${chatTitle}`,
        ].join("\n");
        // Send to all chat members except the sender
        const senderId = (0, number_1.toInt)(message.sender?.user_id);
        const promises = chatMembers
            .filter((member) => member.user_id !== senderId)
            .map((member) => botApi.sendMessageToUser(member.user_id, notificationText).catch((error) => {
            logger_1.logger.warn("Не удалось отправить уведомление о важном сообщении", { error, userId: member.user_id, location: "notifyUsersAboutImportantMessage" });
        }));
        await Promise.allSettled(promises);
    }
}
exports.ImportantMessageService = ImportantMessageService;
exports.importantMessageService = new ImportantMessageService();
//# sourceMappingURL=importantMessageService.js.map