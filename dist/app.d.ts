export declare class App {
    private readonly bot;
    private welcomeImageToken;
    init(): Promise<void>;
    /**
     * Предзагрузка изображения приветствия для оптимизации команды /start
     */
    private preloadWelcomeImage;
    start(): Promise<void>;
    stop(): Promise<void>;
    private registerHandlers;
    /**
     * Обработчик команды /start (вынесен в отдельный метод для переиспользования)
     */
    private handleStartCommand;
    /**
     * Проверяет, упомянут ли бот в сообщении
     */
    private isBotMentioned;
    private handleIncomingMessage;
    private getHelpText;
    private handleHelpCommand;
    /**
     * Получает ID чата для команды:
     * - Если команда из группового чата, использует этот чат
     * - Если команда из личного чата, использует выбранный активный чат
     * - Автоматически добавляет групповой чат в список пользователя при первом использовании
     */
    private getChatIdForCommand;
    /**
     * Получает информацию о текущем активном чате для пользователя
     */
    private getActiveChatInfo;
    private handleDigestCommand;
    private handleDeadlinesCommand;
    private handleCalendarCommand;
    private handleSearchCommand;
    private handleMaterialsCommand;
    private handleTasksCommand;
    private handleChatsCommand;
    private handleSelectChatCommand;
    private handleSyncChatsCommand;
    private resolveRange;
    private readonly handleReminder;
    /**
     * Регистрация обработчиков для callback кнопок
     */
    private registerButtonHandlers;
}
//# sourceMappingURL=app.d.ts.map