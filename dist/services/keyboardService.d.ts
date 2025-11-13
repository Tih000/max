/**
 * Сервис для создания клавиатур с кнопками управления ботом
 */
export declare class KeyboardService {
    /**
     * Главное меню с основными функциями
     * @param activeChatTitle - название активного чата (опционально)
     */
    getMainMenu(activeChatTitle?: string | null): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура для управления чатами
     */
    getChatsMenu(): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура для управления задачами
     */
    getTasksMenu(): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура для дайджеста
     */
    getDigestMenu(): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура для настроек
     */
    getSettingsMenu(): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура для подтверждения действий
     */
    getConfirmMenu(confirmAction: string, cancelAction?: string): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура с кнопкой "Назад"
     */
    getBackMenu(): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура для календаря с опциями экспорта
     */
    getCalendarMenu(): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
    /**
     * Клавиатура для выбора чата (динамическая, создается на основе списка чатов)
     */
    getChatSelectionMenu(chats: Array<{
        id: number;
        title: string;
    }>, selectedChatId?: number): import("@maxhub/max-bot-api/dist/core/network/api").InlineKeyboardAttachmentRequest;
}
export declare const keyboardService: KeyboardService;
//# sourceMappingURL=keyboardService.d.ts.map