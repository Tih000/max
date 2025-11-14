import { prisma } from "../db";
import { appConfig } from "../config";
import { toInt } from "../utils/number";

export class PreferenceService {
  async getOrCreate(userId: number | string) {
    const normalizedUserId = toInt(userId);
    if (!normalizedUserId) {
      throw new Error("Не удалось определить ID пользователя");
    }
    const existing = await prisma.userPreference.findUnique({ where: { userId: normalizedUserId } });
    if (existing) {
      return existing;
    }

    return prisma.userPreference.create({
      data: {
        userId: normalizedUserId,
        timezone: appConfig.DEFAULT_TIMEZONE,
        reminderOffsetMinutes: 120,
      },
    });
  }

}

export const preferenceService = new PreferenceService();

