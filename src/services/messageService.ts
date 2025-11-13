import type { Message as MaxMessage } from "@maxhub/max-bot-api/dist/core/network/api";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { MaterialInfo } from "../types";
import { ensureIdString, toIdString } from "../utils/ids";
import { sanitizeText } from "../utils/text";
import { gigaChatService } from "./gigachatService";

export class MessageService {
  async upsertFromMaxMessage(message: MaxMessage) {
    const attachments = message.body.attachments ?? Prisma.JsonNull;

    const chatId = ensureIdString(message.recipient.chat_id);
    const data: Prisma.MessageUpsertArgs["create"] = {
      id: message.body.mid,
      chatId,
      chatType: message.recipient.chat_type ?? "unknown",
      senderId: toIdString(message.sender?.user_id) ?? undefined,
      senderName: message.sender?.name ?? undefined,
      senderUsername: message.sender?.username ?? undefined,
      text: sanitizeText(message.body.text),
      attachments: attachments as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
      timestamp: new Date(message.timestamp),
    };

    await prisma.message.upsert({
      where: { id: data.id },
      update: data,
      create: data,
    });

    const materials = this.extractMaterials(message);
    if (materials.length > 0) {
      await prisma.material.deleteMany({
        where: { messageId: message.body.mid },
      });

      // Получаем контекст сообщения для анализа материалов
      const messageText = sanitizeText(message.body.text) || "";
      const context = messageText.length > 0 ? messageText.substring(0, 500) : undefined;

      // Сначала сохраняем материалы без описания (быстро)
      const materialsToSave = materials.map((material) => ({
        chatId,
        messageId: material.messageId,
        title: material.title,
        link: material.link ?? null,
        type: material.type ?? null,
        fileName: material.fileName ?? null,
        fileType: material.fileType ?? null,
        description: material.description ?? null,
      }));

      await prisma.material.createMany({
        data: materialsToSave,
        skipDuplicates: true,
      });

      // Затем анализируем материалы через ИИ асинхронно (в фоне, не блокируем)
      // Обновляем описание после анализа
      if (gigaChatService.enabled && materials.length > 0) {
        // Запускаем анализ в фоне без блокировки
        Promise.all(
          materials.map(async (material) => {
            try {
              const description = await gigaChatService.analyzeMaterial(material, context);
              if (description) {
                // Обновляем материал с описанием
                await prisma.material.updateMany({
                  where: {
                    messageId: material.messageId,
                    title: material.title,
                  },
                  data: {
                    description,
                  },
                });
              }
            } catch (error) {
              logger.warn("Ошибка анализа материала через ИИ", {
                error: error instanceof Error ? error.message : String(error),
                material: material.title,
                location: "upsertFromMaxMessage",
              });
            }
          }),
        ).catch((error) => {
          logger.warn("Ошибка при анализе материалов через ИИ", {
            error: error instanceof Error ? error.message : String(error),
            location: "upsertFromMaxMessage",
          });
        });
      }
    }

    return data;
  }


  private extractMaterials(message: MaxMessage): MaterialInfo[] {
    const attachments = message.body.attachments ?? [];
    const baseTitle = sanitizeText(message.body.text) || "Материал";
    const materials: MaterialInfo[] = [];

    attachments.forEach((attachment: any) => {
      const attachmentType = attachment?.type;
      const payload = attachment?.payload;
      
      if (attachmentType === "share") {
        materials.push({
          title: payload?.title ?? baseTitle,
          link: payload?.url ?? undefined,
          messageId: message.body.mid,
          type: "share",
          fileName: payload?.title ?? undefined,
          fileType: undefined,
        });
      }

      if (attachmentType === "image") {
        // Для фотографий используем "фотка", если нет названия
        const imageTitle = payload?.name || "фотка";
        materials.push({
          title: imageTitle,
          link: payload?.url ?? undefined,
          messageId: message.body.mid,
          type: "image",
          fileName: payload?.name ?? undefined,
          fileType: payload?.mimeType ?? payload?.type ?? "image/jpeg",
        });
      }

      if (attachmentType === "file") {
        // Для файлов используем название файла, если есть, иначе "файл"
        const fileName = payload?.name || "файл";
        materials.push({
          title: fileName,
          link: payload?.url ?? undefined,
          messageId: message.body.mid,
          type: "file",
          fileName: payload?.name ?? undefined,
          fileType: payload?.mimeType ?? payload?.type ?? "application/octet-stream",
        });
      }

      if (attachmentType === "video") {
        // Для видео используем название, если есть, иначе "видео"
        const videoTitle = payload?.name || "видео";
        materials.push({
          title: videoTitle,
          link: payload?.url ?? undefined,
          messageId: message.body.mid,
          type: "video",
          fileName: payload?.name ?? undefined,
          fileType: payload?.mimeType ?? payload?.type ?? "video/mp4",
        });
      }
    });

    return materials;
  }
}

export const messageService = new MessageService();

