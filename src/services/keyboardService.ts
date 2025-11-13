import { Keyboard } from "@maxhub/max-bot-api";

/**
 * Сервис для создания клавиатур с кнопками управления ботом
 */
export class KeyboardService {
  /**
   * Главное меню с основными функциями
   * @param activeChatTitle - название активного чата (опционально)
   */
  getMainMenu(activeChatTitle?: string | null) {
    const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];
    
    // Показываем активный чат, если он выбран
    if (activeChatTitle) {
      const title = activeChatTitle.length > 30 ? `${activeChatTitle.substring(0, 30)}...` : activeChatTitle;
      buttons.push([
        Keyboard.button.callback(`✅ Активный чат: ${title}`, "action:chats", { intent: "positive" }),
      ]);
    } else {
      buttons.push([
        Keyboard.button.callback("📋 Выбрать чат", "action:chats", { intent: "default" }),
      ]);
    }
    
    buttons.push(
      [
        Keyboard.button.callback("📅 Дедлайны", "action:deadlines", { intent: "default" }),
        Keyboard.button.callback("✅ Задачи", "action:tasks", { intent: "default" }),
      ],
      [
        Keyboard.button.callback("📚 Материалы", "action:materials", { intent: "default" }),
        Keyboard.button.callback("📊 Дайджест", "action:digest", { intent: "default" }),
      ],
      [
        Keyboard.button.callback("🔍 Поиск", "action:search", { intent: "default" }),
        Keyboard.button.callback("📆 Календарь", "action:calendar", { intent: "positive" }),
      ],
      [
        Keyboard.button.callback("⚙️ Настройки", "action:settings", { intent: "default" }),
        Keyboard.button.callback("❓ Помощь", "action:help", { intent: "default" }),
      ],
    );

    return Keyboard.inlineKeyboard(buttons);
  }

  /**
   * Клавиатура для управления чатами
   */
  getChatsMenu() {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback("📋 Список чатов", "action:chats_list", { intent: "default" })],
      [Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
    ]);
  }

  /**
   * Клавиатура для управления задачами
   */
  getTasksMenu() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback("📋 Все задачи", "action:tasks_list", { intent: "default" }),
      ],
      [
        Keyboard.button.callback("📅 На неделю", "action:tasks_week", { intent: "default" }),
        Keyboard.button.callback("📅 На завтра", "action:tasks_tomorrow", { intent: "default" }),
      ],
      [Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
    ]);
  }

  /**
   * Клавиатура для дайджеста
   */
  getDigestMenu() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback("📊 За сегодня", "action:digest_today", { intent: "default" }),
        Keyboard.button.callback("📊 За неделю", "action:digest_week", { intent: "default" }),
      ],
      [
        Keyboard.button.callback("📊 За период", "action:digest_period", { intent: "default" }),
        Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" }),
      ],
    ]);
  }

  /**
   * Клавиатура для настроек
   */
  getSettingsMenu() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback("⏰ Напоминания", "action:settings_reminders", { intent: "default" }),
        Keyboard.button.callback("📅 Дайджест", "action:settings_digest", { intent: "default" }),
      ],
      [Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
    ]);
  }

  /**
   * Клавиатура для подтверждения действий
   */
  getConfirmMenu(confirmAction: string, cancelAction: string = "action:main_menu") {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback("✅ Да", confirmAction, { intent: "positive" }),
        Keyboard.button.callback("❌ Нет", cancelAction, { intent: "negative" }),
      ],
    ]);
  }

  /**
   * Клавиатура с кнопкой "Назад"
   */
  getBackMenu() {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
    ]);
  }

  /**
   * Клавиатура для календаря с опциями экспорта
   */
  getCalendarMenu() {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback("📊 Экспорт в Excel", "action:calendar_export_excel", { intent: "positive" }),
      ],
      [Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" })],
    ]);
  }

  /**
   * Клавиатура для выбора чата (динамическая, создается на основе списка чатов)
   */
  getChatSelectionMenu(chats: Array<{ id: number; title: string }>, selectedChatId?: number) {
    const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];

    // Группируем кнопки по 2 в ряд
    for (let i = 0; i < chats.length; i += 2) {
      const row: ReturnType<typeof Keyboard.button.callback>[] = [];
      const chat1 = chats[i];
      if (chat1) {
        const isSelected = selectedChatId === chat1.id;
        const title = chat1.title.length > 18 ? `${chat1.title.substring(0, 18)}...` : chat1.title;
        row.push(
          Keyboard.button.callback(
            isSelected ? `✅ ${title}` : title,
            `action:select_chat:${chat1.id}`,
            { intent: isSelected ? "positive" : "default" },
          ),
        );
      }
      const chat2 = chats[i + 1];
      if (chat2) {
        const isSelected = selectedChatId === chat2.id;
        const title = chat2.title.length > 18 ? `${chat2.title.substring(0, 18)}...` : chat2.title;
        row.push(
          Keyboard.button.callback(
            isSelected ? `✅ ${title}` : title,
            `action:select_chat:${chat2.id}`,
            { intent: isSelected ? "positive" : "default" },
          ),
        );
      }
      if (row.length > 0) {
        buttons.push(row);
      }
    }

    buttons.push([
      Keyboard.button.callback("🔙 Назад", "action:main_menu", { intent: "default" }),
    ]);

    return Keyboard.inlineKeyboard(buttons);
  }
}

export const keyboardService = new KeyboardService();

