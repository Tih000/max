"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferenceService = exports.PreferenceService = void 0;
const db_1 = require("../db");
const config_1 = require("../config");
const ids_1 = require("../utils/ids");
class PreferenceService {
    async getOrCreate(userId) {
        const normalizedUserId = (0, ids_1.ensureIdString)(userId);
        const existing = await db_1.prisma.userPreference.findUnique({ where: { userId: normalizedUserId } });
        if (existing) {
            return existing;
        }
        return db_1.prisma.userPreference.create({
            data: {
                userId: normalizedUserId,
                timezone: config_1.appConfig.DEFAULT_TIMEZONE,
                reminderOffsetMinutes: 120,
            },
        });
    }
}
exports.PreferenceService = PreferenceService;
exports.preferenceService = new PreferenceService();
//# sourceMappingURL=preferenceService.js.map