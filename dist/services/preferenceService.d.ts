export declare class PreferenceService {
    getOrCreate(userId: number | string): Promise<{
        userId: string;
        createdAt: Date;
        updatedAt: Date;
        timezone: string;
        reminderOffsetMinutes: number;
        quietHours: import("@prisma/client/runtime/library").JsonValue | null;
        digestScheduleCron: string | null;
        selectedChatId: string | null;
    }>;
}
export declare const preferenceService: PreferenceService;
//# sourceMappingURL=preferenceService.d.ts.map