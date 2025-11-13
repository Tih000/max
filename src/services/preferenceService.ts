import { prisma } from "../db";
import { appConfig } from "../config";
import { ensureIdString } from "../utils/ids";

export class PreferenceService {
  async getOrCreate(userId: number | string) {
    const normalizedUserId = ensureIdString(userId);
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

