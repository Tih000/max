"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyboardService = exports.KeyboardService = void 0;
const max_bot_api_1 = require("@maxhub/max-bot-api");
/**
 * Сервис для создания клавиатур с кнопками управления ботом
 */
class KeyboardService {
    /**
     * Главное меню с основными функциями
     * @param activeChatTitle - название активного чата (опционально)
     */
    getMainMenu(activeChatTitle) {
        const buttons = [];
        // Показываем активный чат, если он выбран
        if (activeChatTitle) {
            const title = activeChatTitle.length > 30 ? `${activeChatTitle.substring(0, 30)}...` : activeChatTitle;
            buttons.push([
                max_bot_api_1.Keyboard.button.callback(`✅ Активный чат: ${title}`, "action:chats", { intent: "positive" }),
            ]);
        }
        else {
            buttons.push([
                max_bot_api_1.Keyboard.button.callback("📋 Выбрать чат", "action:chats", { intent: "default" }),
            ]);
        }
        buttons.push([
            max_bot_api_1.Keyboard.button.callback("📅 Дедлайны", "action:deadlines", { intent: "default" }),
            max_bot_api_1.Keyboard.button.callback("✅ Задачи", "action:tasks", { intent: "default" }),
        ], [
            max_bot_api_1.Keyboard.button.callback("📚 Материалы", "action:materials", { intent: "default" }),
            max_bot_api_1.Keyboard.button.callback("📊 Дайджест", "action:digest", { intent: "default" }),
        ], [
            max_bot_api_1.Keyboard.button.callback("🔍 Поиск", "action:search", { intent: "default" }),
            max_bot_api_1.Keyboard.button.callback("📆 Календарь", "action:calendar", { intent: "positive" }),
        ], [
            max_bot_api_1.Keyboard.button.callback("⚙️ Настройки", "action:settings", { intent: "default" }),
            max_bot_api_1.Keyboard.button.callback("❓ Помощь", "action:help", { intent: "default" }),
        ]);
        return max_bot_api_1.Keyboard.inlineKeyboard(buttons);
    }
    /**
     * Клавиатура для управления чатами
     */
    getChatsMenu() {
        return max_bot_api_1.Keyboard.inlineKeyboard([
            [max_bot_api_1.Keyboard.button.callback("📋 Список чатов", "action:chats_list", { intent: "default" })],
            [max_bot_api_1.Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
        ]);
    }
    /**
     * Клавиатура для управления задачами
     */
    getTasksMenu() {
        return max_bot_api_1.Keyboard.inlineKeyboard([
            [
                max_bot_api_1.Keyboard.button.callback("📋 Все задачи", "action:tasks_list", { intent: "default" }),
            ],
            [
                max_bot_api_1.Keyboard.button.callback("📅 На неделю", "action:tasks_week", { intent: "default" }),
                max_bot_api_1.Keyboard.button.callback("📅 На завтра", "action:tasks_tomorrow", { intent: "default" }),
            ],
            [max_bot_api_1.Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
        ]);
    }
    /**
     * Клавиатура для дайджеста
     */
    getDigestMenu() {
        return max_bot_api_1.Keyboard.inlineKeyboard([
            [
                max_bot_api_1.Keyboard.button.callback("📊 За сегодня", "action:digest_today", { intent: "default" }),
                max_bot_api_1.Keyboard.button.callback("📊 За неделю", "action:digest_week", { intent: "default" }),
            ],
            [
                max_bot_api_1.Keyboard.button.callback("📊 За период", "action:digest_period", { intent: "default" }),
                max_bot_api_1.Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" }),
            ],
        ]);
    }
    /**
     * Клавиатура для настроек
     */
    getSettingsMenu() {
        return max_bot_api_1.Keyboard.inlineKeyboard([
            [
                max_bot_api_1.Keyboard.button.callback("⏰ Напоминания", "action:settings_reminders", { intent: "default" }),
                max_bot_api_1.Keyboard.button.callback("📅 Дайджест", "action:settings_digest", { intent: "default" }),
            ],
            [max_bot_api_1.Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
        ]);
    }
    /**
     * Клавиатура для подтверждения действий
     */
    getConfirmMenu(confirmAction, cancelAction = "action:main_menu") {
        return max_bot_api_1.Keyboard.inlineKeyboard([
            [
                max_bot_api_1.Keyboard.button.callback("✅ Да", confirmAction, { intent: "positive" }),
                max_bot_api_1.Keyboard.button.callback("❌ Нет", cancelAction, { intent: "negative" }),
            ],
        ]);
    }
    /**
     * Клавиатура с кнопкой "Назад"
     */
    getBackMenu() {
        return max_bot_api_1.Keyboard.inlineKeyboard([
            [max_bot_api_1.Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
        ]);
    }
    /**
     * Клавиатура для календаря с опциями экспорта
     */
    getCalendarMenu() {
        return max_bot_api_1.Keyboard.inlineKeyboard([
            [
                max_bot_api_1.Keyboard.button.callback("📊 Экспорт в Excel", "action:calendar_export_excel", { intent: "positive" }),
            ],
            [max_bot_api_1.Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
        ]);
    }
    /**
     * Клавиатура для выбора чата (динамическая, создается на основе списка чатов)
     */
    getChatSelectionMenu(chats, selectedChatId) {
        const buttons = [];
        // Группируем кнопки по 2 в ряд
        for (let i = 0; i < chats.length; i += 2) {
            const row = [];
            const chat1 = chats[i];
            if (chat1) {
                const isSelected = selectedChatId === chat1.id;
                const title = chat1.title.length > 18 ? `${chat1.title.substring(0, 18)}...` : chat1.title;
                row.push(max_bot_api_1.Keyboard.button.callback(isSelected ? `✅ ${title}` : title, `action:select_chat:${chat1.id}`, { intent: isSelected ? "positive" : "default" }));
            }
            const chat2 = chats[i + 1];
            if (chat2) {
                const isSelected = selectedChatId === chat2.id;
                const title = chat2.title.length > 18 ? `${chat2.title.substring(0, 18)}...` : chat2.title;
                row.push(max_bot_api_1.Keyboard.button.callback(isSelected ? `✅ ${title}` : title, `action:select_chat:${chat2.id}`, { intent: isSelected ? "positive" : "default" }));
            }
            if (row.length > 0) {
                buttons.push(row);
            }
        }
        buttons.push([
            max_bot_api_1.Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" }),
        ]);
        return max_bot_api_1.Keyboard.inlineKeyboard(buttons);
    }
}
exports.KeyboardService = KeyboardService;
exports.keyboardService = new KeyboardService();
//# sourceMappingURL=keyboardService.js.map