import type { Message as MaxMessage } from "@maxhub/max-bot-api/dist/core/network/api";
import { logger } from "../logger";
import { gigaChatService } from "./gigachatService";
import { toInt } from "../utils/number";
import { sanitizeText } from "../utils/text";

type ImportantMessageInfo = {
  isImportant: boolean;
  reason?: string;
  priority?: "high" | "medium" | "low";
};

export class ImportantMessageService {
  async checkIfImportant(message: MaxMessage): Promise<ImportantMessageInfo> {
    const text = sanitizeText(message.body.text);
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

    const heuristicScore =
      (hasDeadlineKeywords ? 2 : 0) +
      (hasTaskKeywords ? 2 : 0) +
      (hasAssignmentKeywords ? 2 : 0) +
      (hasUrgentKeywords ? 3 : 0) +
      (hasQuestion ? 1 : 0) +
      (mentionsUser ? 1 : 0);

    if (heuristicScore >= 3) {
      const reasons: string[] = [];
      if (hasDeadlineKeywords) reasons.push("дедлайн");
      if (hasTaskKeywords) reasons.push("задача");
      if (hasUrgentKeywords) reasons.push("срочно");
      if (hasAssignmentKeywords) reasons.push("назначение");

      return {
        isImportant: true,
        reason: reasons.join(", "),
        priority: heuristicScore >= 5 ? "high" : heuristicScore >= 3 ? "medium" : "low",
      };
    }

    // LLM check if enabled
    if (gigaChatService.enabled) {
      try {
        const isImportant = await gigaChatService.checkMessageImportance(text);
        if (isImportant) {
          return {
            isImportant: true,
            reason: "важное сообщение",
            priority: "medium",
          };
        }
      } catch (error) {
        logger.warn("Ошибка проверки важности сообщения GigaChat", { error, location: "checkIfImportant" });
      }
    }

    return { isImportant: false };
  }

  async notifyUsersAboutImportantMessage(
    message: MaxMessage,
    chatMembers: Array<{ user_id: number }>,
    botApi: { sendMessageToUser: (userId: number, text: string) => Promise<unknown> },
  ) {
    const text = sanitizeText(message.body.text) ?? "";
    const senderName = message.sender?.name ?? "Участник";
    const chatTitle = (message.recipient as { chat_title?: string }).chat_title ?? "Чат";

    const notificationText = [
      `🔔 Важное сообщение из чата «${chatTitle}»:`,
      "",
      `${senderName}:`,
      text.length > 300 ? `${text.substring(0, 300)}...` : text,
      "",
      `Чат: ${chatTitle}`,
    ].join("\n");

    // Send to all chat members except the sender
    const senderId = toInt(message.sender?.user_id);
    const promises = chatMembers
      .filter((member) => member.user_id !== senderId)
      .map((member) =>
        botApi.sendMessageToUser(member.user_id, notificationText).catch((error) => {
          logger.warn("Не удалось отправить уведомление о важном сообщении", { error, userId: member.user_id, location: "notifyUsersAboutImportantMessage" });
        }),
      );

    await Promise.allSettled(promises);
  }
}

export const importantMessageService = new ImportantMessageService();

