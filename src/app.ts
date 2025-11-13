import type { Context } from "@maxhub/max-bot-api";
import { Bot, FileAttachment, ImageAttachment } from "@maxhub/max-bot-api";
import type { Message } from "@maxhub/max-bot-api/dist/core/network/api";
import type { AttachmentRequest } from "@maxhub/max-bot-api/dist/core/network/api/types/attachment-request";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appConfig } from "./config";
import { connectDatabase, disconnectDatabase, prisma } from "./db";
import { logger } from "./logger";
import { assistantService } from "./services/assistantService";
import { calendarService } from "./services/calendarService";
import { digestService } from "./services/digestService";
import { importantMessageService } from "./services/importantMessageService";
import { keyboardService } from "./services/keyboardService";
import { messageService } from "./services/messageService";
import { preferenceService } from "./services/preferenceService";
import { reminderService, type ReminderHandler } from "./services/reminderService";
import { scheduledDigestService } from "./services/scheduledDigestService";
import { searchService } from "./services/searchService";
import { taskService } from "./services/taskService";
import { userChatService } from "./services/userChatService";
import { addDays, endOfDay, endOfWeek, formatDate, startOfDay, startOfWeek } from "./utils/date";
import { ensureIdString } from "./utils/ids";
import { toInt } from "./utils/number";
import { formatBulletList, formatMaterials, sanitizeText } from "./utils/text";

type CommandContext = Context & { message: Message };

export class App {
  private readonly bot = new Bot(appConfig.MAX_BOT_TOKEN);
  private welcomeImageToken: string | null = null;

  async init() {
    await connectDatabase();
    await reminderService.init(this.handleReminder);
    await scheduledDigestService.init(this.bot.api);
    assistantService.setBotApi(this.bot.api); // Передаем API для получения участников чата
    digestService.setBotApi(this.bot.api); // Передаем API для дайджестов
    
    // Предзагружаем изображение приветствия для быстрого доступа
    await this.preloadWelcomeImage();
    
    this.registerHandlers();
  }

  /**
   * Предзагрузка изображения приветствия для оптимизации команды /start
   */
  private async preloadWelcomeImage() {
    try {
      const imagePath = join(process.cwd(), "src", "start_photo.png");
      const image = await this.bot.api.uploadImage({
        source: readFileSync(imagePath),
      });
      // Сохраняем токен изображения для быстрого использования
      const imageJson = image.toJson();
      if (imageJson.type === "image" && "payload" in imageJson && imageJson.payload) {
        const payload = imageJson.payload as { photos?: Record<string, { token: string }> };
        if (payload.photos) {
          const firstPhoto = Object.values(payload.photos)[0];
          if (firstPhoto?.token) {
            this.welcomeImageToken = firstPhoto.token;
            logger.system("Изображение приветствия предзагружено");
          }
        }
      }
    } catch (error) {
      logger.warn("Не удалось предзагрузить изображение приветствия", {
        location: "preloadWelcomeImage",
        error,
      });
      // Продолжаем без изображения
    }
  }

  async start() {
    try {
      logger.system("Запуск бота...");
      
      // Retry logic for getMyInfo() - handles network errors
      let botInfoRetries = 0;
      const maxBotInfoRetries = 3;
      while (botInfoRetries < maxBotInfoRetries) {
        try {
          this.bot.botInfo ??= await this.bot.api.getMyInfo();
          logger.system(`Бот запущен: @${this.bot.botInfo?.username ?? "unknown"}`);
          break; // Success
        } catch (error) {
          botInfoRetries++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          if (errorMessage.includes("fetch failed") || (error as { name?: string })?.name === "FetchError") {
            logger.warn(`Ошибка сети при получении информации о боте (попытка ${botInfoRetries}/${maxBotInfoRetries})`, {
              location: "App.start",
            });
            
            if (botInfoRetries < maxBotInfoRetries) {
              const delay = botInfoRetries * 2000; // 2s, 4s, 6s
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
          }
          
          // For other errors or max retries, throw
          logger.error("Не удалось получить информацию о боте", {
            location: "start.getBotInfo",
            error,
          });
          throw error;
        }
      }
      
      // Start polling - it has built-in retry logic for FetchError in getUpdates()
      this.bot.start().catch((error) => {
        logger.error("Ошибка в цикле polling", {
          location: "start.polling",
          error,
        });
      });
      logger.system("Бот запущен и готов к работе");
      // Give polling a moment to start
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logger.error("Не удалось запустить бота", {
        location: "start",
        error,
      });
      throw error;
    }
  }

  async stop() {
    await this.bot.stop();
    await disconnectDatabase();
    logger.system("Бот остановлен");
  }

  private registerHandlers() {
    this.bot.catch(async (error, ctx) => {
      const userId = toInt(ctx.user?.user_id);
      logger.error("Необработанная ошибка бота", {
        userId,
        action: ctx.update?.update_type,
        location: "bot.catch",
        error,
      });
    });

    // Middleware для обработки обновлений
    this.bot.use(async (ctx, next) => {
      try {
        await next();
      } catch (error) {
        const userId = toInt(ctx.user?.user_id);
        logger.error("Ошибка обработки обновления", {
          userId,
          action: ctx.updateType,
          location: "bot.use",
          error,
        });
        throw error;
      }
    });

    this.bot.on("bot_started", async (ctx) => {
      try {
        const botInfo = this.bot.botInfo;
        if (botInfo) {
          logger.system(`Бот готов к работе: @${botInfo.username}`);
        }
      } catch (error) {
        logger.error("Ошибка в обработчике bot_started (системное сообщение)", {
          location: "bot_started.system",
          error,
        });
      }

      const userId = toInt(ctx.user?.user_id);
      
      // Логируем событие bot_started для отладки (всегда, даже если userId нет)
      const update = ctx.update as { payload?: string | null } | undefined;
      const startPayload = ctx.startPayload ?? update?.payload;
      const hasStartPayload = startPayload && startPayload !== null;
      
      logger.info({
        userId: userId ?? undefined,
        hasUser: !!ctx.user,
        hasStartPayload,
        startPayload,
        updateType: ctx.updateType,
        location: "bot_started",
      }, "Событие bot_started получено");

      if (!userId) {
        logger.warn("Событие bot_started без userId, пропускаем отправку приветствия", {
          user: ctx.user,
          location: "bot_started",
        });
        return;
      }

      await preferenceService.getOrCreate(userId);
      
      // Получаем имя пользователя
      const userName = ctx.user?.name ?? "друг";
      
      // Получаем информацию об активном чате
      const activeChat = await this.getActiveChatInfo(userId);
      
      const welcomeText = [
        `Привет, ${userName}! 👋`,
        "",
        "Я — твой персональный AI-агент по аналитике чатов для MAX.",
        "",
        activeChat
          ? `✅ Активный чат: ${activeChat.title ?? `Чат ${activeChat.id}`}`
          : "⚠️ Выберите активный чат для работы (кнопка ниже)",
        "",
        "Используй кнопки ниже для быстрого доступа к функциям:",
        "",
        "💬 В личных сообщениях можно задавать вопросы:",
        "• «какие дедлайны завтра?»",
        "• «какие материалы к экзамену?»",
        "• «есть задачи на завтра?»",
      ].join("\n");
      
      // Подготавливаем вложения: изображение (из кэша) + клавиатура
      const attachments: AttachmentRequest[] = [];
      
      // Используем предзагруженное изображение из кэша
      if (this.welcomeImageToken) {
        try {
          const image = new ImageAttachment({ token: this.welcomeImageToken });
          attachments.push(image.toJson());
        } catch (error) {
          logger.warn("Не удалось использовать кэшированное изображение", {
            userId,
            location: "bot_started.welcomeImage",
            error,
          });
        }
      }
      
      // Добавляем клавиатуру (всегда добавляем, даже если есть изображение)
      const keyboard = keyboardService.getMainMenu(activeChat?.title ?? null);
      attachments.push(keyboard);
      
      logger.info({
        userId,
        attachmentsCount: attachments.length,
        hasImage: this.welcomeImageToken ? true : false,
        hasKeyboard: true,
        hasStartPayload,
        userName,
        location: "bot_started",
      }, "Отправка приветствия (bot_started)");
      
      try {
        await ctx.reply(welcomeText, { attachments });
        logger.success("Приветствие отправлено успешно", { userId, userName });
      } catch (error) {
        logger.error("Ошибка при отправке приветствия", {
          userId,
          userName,
          location: "bot_started.reply",
          error,
        });
        throw error;
      }
      
      // Логируем, если это было нажатие на кнопку "Начать"
      if (hasStartPayload) {
        logger.userAction(userId, "Кнопка 'Начать' нажата через bot_started", { 
          userName: ctx.user?.name ?? "друг",
          payload: update?.payload 
        });
      }
    });

    this.bot.command("start", async (ctx) => {
      const userId = ctx.user ? toInt((ctx.user as { user_id?: number }).user_id) : null;
      logger.command(userId ?? undefined, "start", ctx.chatId);
      
      await this.handleStartCommand(ctx as CommandContext);
    });
    this.bot.command("help", async (ctx) => {
      const userId = ctx.user ? toInt((ctx.user as { user_id?: number }).user_id) : null;
      logger.command(userId ?? undefined, "help", ctx.chatId);
      await this.handleHelpCommand(ctx as CommandContext);
    });
    // Используем регулярные выражения для команд с аргументами
    this.bot.command(/^digest(\s|$)/, async (ctx) => this.handleDigestCommand(ctx as CommandContext));
    this.bot.command("deadlines", async (ctx) => this.handleDeadlinesCommand(ctx as CommandContext));
    this.bot.command("calendar", async (ctx) => this.handleCalendarCommand(ctx as CommandContext));
    this.bot.command(/^search(\s|$)/, async (ctx) => this.handleSearchCommand(ctx as CommandContext));
    this.bot.command("materials", async (ctx) => this.handleMaterialsCommand(ctx as CommandContext));
    this.bot.command("tasks", async (ctx) => this.handleTasksCommand(ctx as CommandContext));
    this.bot.command("chats", async (ctx) => this.handleChatsCommand(ctx as CommandContext));
    this.bot.command("select_chat", async (ctx) => this.handleSelectChatCommand(ctx as CommandContext));
    this.bot.command("sync_chats", async (ctx) => this.handleSyncChatsCommand(ctx as CommandContext));

    // Обработчики callback кнопок
    this.registerButtonHandlers();

    // Обработчик текста "Начать" (на случай, если кнопка отправляет текст)
    this.bot.hears(/^(Начать|начать|START|start)$/i, async (ctx) => {
      const userId = ctx.user ? toInt((ctx.user as { user_id?: number }).user_id) : null;
      if (!userId) return;
      
      logger.debug("Получен текст 'Начать'", {
        userId,
        messageText: ctx.message?.body.text,
        location: "hears.Начать",
      });
      
      // Вызываем тот же обработчик, что и для команды /start
      await this.handleStartCommand(ctx as CommandContext);
    });

    this.bot.on("message_created", async (ctx) => {
      if (!ctx.message) return;
      await this.handleIncomingMessage(ctx);
    });
  }

  /**
   * Обработчик команды /start (вынесен в отдельный метод для переиспользования)
   */
  private async handleStartCommand(ctx: CommandContext) {
    const userId = ctx.user ? toInt((ctx.user as { user_id?: number }).user_id) : null;
    
    if (!userId) {
      await ctx.reply("Ошибка: не удалось определить пользователя");
      return;
    }

    await preferenceService.getOrCreate(userId);

    // Получаем имя пользователя
    const userName = ctx.user && typeof ctx.user === 'object' && 'name' in ctx.user 
      ? (ctx.user as { name?: string }).name ?? "друг"
      : "друг";
    
    // Выполняем операции параллельно для ускорения
    const [activeChat] = await Promise.all([
      this.getActiveChatInfo(userId),
    ]);
    
    const welcomeText = [
      `Привет, ${userName}! 👋`,
      "",
      "Я — твой персональный AI-агент по аналитике чатов для MAX.",
      "",
      activeChat
        ? `✅ Активный чат: ${activeChat.title ?? `Чат ${activeChat.id}`}`
        : "⚠️ Выберите активный чат для работы (кнопка ниже)",
      "",
      "Используй кнопки ниже для быстрого доступа к функциям:",
      "",
      "💬 В личных сообщениях можно задавать вопросы:",
      "• «какие дедлайны завтра?»",
      "• «какие материалы к экзамену?»",
      "• «есть задачи на завтра?»",
    ].join("\n");
    
    // Подготавливаем вложения: изображение (из кэша) + клавиатура
    const attachments: AttachmentRequest[] = [];
    
    // Используем предзагруженное изображение из кэша
    if (this.welcomeImageToken) {
      try {
        const image = new ImageAttachment({ token: this.welcomeImageToken });
        attachments.push(image.toJson());
      } catch (error) {
        logger.warn("Не удалось использовать кэшированное изображение", {
          userId,
          location: "handleStartCommand.welcomeImage",
          error,
        });
      }
    }
    
    // Добавляем клавиатуру
    attachments.push(keyboardService.getMainMenu(activeChat?.title ?? null));
    
    await ctx.reply(welcomeText, { attachments });
    logger.userAction(userId, "Команда /start выполнена", { userName });
  }

  /**
   * Проверяет, упомянут ли бот в сообщении
   */
  private isBotMentioned(message: Message, botUserId?: number): boolean {
    if (!botUserId) {
      return false;
    }

    // Проверяем упоминания в markup
    const markup = message.body.markup ?? [];
    const mention = markup.find((m) => {
      if (m.type === "user_mention") {
        const userId = toInt(m.user_id);
        return userId === botUserId;
      }
      return false;
    });

    if (mention) {
      return true;
    }

    // Проверяем упоминание по username в тексте
    const text = message.body.text ?? "";
    const botInfo = this.bot.botInfo as { username?: string } | undefined;
    const botUsername = botInfo?.username;
    if (botUsername && text.includes(`@${botUsername}`)) {
      return true;
    }

    return false;
  }

  private async handleIncomingMessage(ctx: Context & { message: Message }) {
    const { message } = ctx;
    
    // Сохраняем все сообщения в БД (тихо, без ответов)
    try {
      await messageService.upsertFromMaxMessage(message);
    } catch (error) {
        logger.error("Не удалось сохранить сообщение", {
          location: "handleIncomingMessage.saveMessage",
          userId: toInt(message.sender?.user_id),
          chatId: toInt(message.recipient.chat_id),
          error,
        });
    }

    // Auto-add chat to user's list if message is from group chat
    const chatType = message.recipient.chat_type;
    const isPersonal = chatType === "dialog";
    if (!isPersonal) {
      const userId = toInt(message.sender?.user_id);
      const chatId = toInt(message.recipient.chat_id);
      if (userId && chatId) {
        try {
          const chatTitle = ctx.chat?.title ?? undefined;
          await userChatService.addChat(userId, chatId, chatTitle);
        } catch (error) {
          logger.warn("Не удалось автоматически добавить чат", {
            location: "handleIncomingMessage.addChat",
            userId,
            chatId,
            error,
          });
        }
      }
    }

    const text = sanitizeText(message.body.text);
    if (!text) {
      return;
    }

    const isCommand = text.startsWith("/");

    // Команды обрабатываются отдельно
    if (isCommand) {
      return;
    }

    // В личных сообщениях всегда отвечаем
    if (isPersonal) {
      const userId = toInt(message.sender?.user_id);
      if (!userId) {
        logger.warn("Не удалось определить пользователя", {
          location: "handleIncomingMessage.personalChat",
        });
        await ctx.reply("Не удалось определить пользователя. Попробуйте позже.");
        return;
      }

      // Проверяем, первый ли это раз взаимодействия с ботом
      const userIdString = ensureIdString(userId);
      const existingPreference = await prisma.userPreference.findUnique({
        where: { userId: userIdString },
      });
      
      // Если это первый раз - показываем приветствие с кнопками
      if (!existingPreference) {
        // Создаем preferences для пользователя
        await preferenceService.getOrCreate(userId);
        
        // Получаем имя пользователя
        const userName = message.sender?.name ?? "друг";
        
        // Получаем информацию об активном чате
        const activeChat = await this.getActiveChatInfo(userId);
        
        const welcomeText = [
          `Привет, ${userName}! 👋`,
          "",
          "Я — твой персональный AI-агент по аналитике чатов для MAX.",
          "",
          activeChat
            ? `✅ Активный чат: ${activeChat.title ?? `Чат ${activeChat.id}`}`
            : "⚠️ Выберите активный чат для работы (кнопка ниже)",
          "",
          "Используй кнопки ниже для быстрого доступа к функциям:",
          "",
          "💬 В личных сообщениях можно задавать вопросы:",
          "• «какие дедлайны завтра?»",
          "• «какие материалы к экзамену?»",
          "• «есть задачи на завтра?»",
        ].join("\n");
        
        // Подготавливаем вложения: изображение (из кэша) + клавиатура
        const attachments: AttachmentRequest[] = [];
        
        // Используем предзагруженное изображение из кэша
        if (this.welcomeImageToken) {
          try {
            const image = new ImageAttachment({ token: this.welcomeImageToken });
            attachments.push(image.toJson());
          } catch (error) {
            logger.warn("Не удалось использовать кэшированное изображение", {
              userId,
              location: "handleIncomingMessage.welcomeImage",
              error,
            });
          }
        }
        
        // Добавляем клавиатуру (всегда добавляем, даже если есть изображение)
        const keyboard = keyboardService.getMainMenu(activeChat?.title ?? null);
        attachments.push(keyboard);
        
        logger.debug("Отправка приветствия", {
          userId,
          attachmentsCount: attachments.length,
          hasImage: this.welcomeImageToken ? true : false,
          hasKeyboard: true,
        });
        
        await ctx.reply(welcomeText, { attachments });
        logger.userAction(userId, "Первое взаимодействие с ботом - показано приветствие", { userName });
        return;
      }

      // Используем активный чат пользователя
      const selectedChatId = await userChatService.getSelectedChat(userId);
      const chatId = selectedChatId ? toInt(selectedChatId) : null;

      // Если чат не выбран, предлагаем выбрать
      if (!chatId) {
        logger.userAction(userId, "Задан вопрос без выбранного чата", { question: text.substring(0, 50) });
        const replyText = [
          "❌ Активный чат не выбран.",
          "",
          "Для работы с вопросами нужно выбрать активный чат.",
          "Используйте кнопку ниже для выбора чата:",
        ].join("\n");
        
        await ctx.reply(replyText, { attachments: [keyboardService.getChatsMenu()] });
        return;
      }

      logger.userAction(userId, "Задан вопрос ассистенту", { chatId, question: text.substring(0, 50) });
      const answer = await assistantService.answerPersonalQuestion(userId, chatId, text, this.bot.api);
      await ctx.reply(answer.body);
      logger.success("Ответ ассистента отправлен", { userId, chatId });
      return;
    }

    // В групповых чатах обрабатываем только если бот упомянут или это команда
    // Получаем user_id бота из botInfo (BotInfo extends UserWithPhoto extends User which has user_id)
    const botInfo = this.bot.botInfo;
    const botUserId = botInfo ? toInt((botInfo as { user_id: number }).user_id) : undefined;
    const isMentioned = this.isBotMentioned(message, botUserId);

    if (!isMentioned) {
      // Бот не упомянут - только сохраняем сообщение, но не отвечаем
      // Тихо обрабатываем задачи и важные сообщения в фоне (без ответа в чат)
      try {
        // Обрабатываем задачи тихо (без ответа в чат)
        await taskService.processIncomingMessage(message);
        
        // Проверяем важность сообщения (уведомления отправляются в личку, не в чат)
        const importance = await importantMessageService.checkIfImportant(message);
        if (importance.isImportant) {
          try {
            const chatId = toInt(message.recipient.chat_id);
            if (chatId) {
              const members = await this.bot.api.getChatMembers(chatId);
              if (members?.members) {
                await importantMessageService.notifyUsersAboutImportantMessage(
                  message,
                  members.members
                    .map((m) => {
                      const userId = toInt(m.user_id);
                      return userId ? { user_id: userId } : null;
                    })
                    .filter((m): m is { user_id: number } => m !== null),
                  this.bot.api,
                );
              }
            }
          } catch (error) {
            logger.warn("Не удалось уведомить пользователей о важном сообщении", {
              location: "handleIncomingMessage.notifyImportant",
              chatId: toInt(message.recipient.chat_id),
              error,
            });
          }
        }
      } catch (error) {
        logger.error("Не удалось обработать задачи из сообщения", {
          location: "handleIncomingMessage.processTasks",
          userId: toInt(message.sender?.user_id),
          chatId: toInt(message.recipient.chat_id),
          error,
        });
      }
      return;
    }

    // Бот упомянут - обрабатываем и отвечаем
    try {
      const createdTasks = await taskService.processIncomingMessage(message);
      if (createdTasks.length > 0) {
        const response = [
          "Нашёл потенциальные задачи:",
          formatBulletList(
            createdTasks.map((task) => {
              const due = task.dueDate ? `дедлайн ${formatDate(task.dueDate)}` : "без срока";
              const assignee = task.assigneeName ? `ответственный: ${task.assigneeName}` : "ответственный не назначен";
              return `${task.title} — ${due}, ${assignee}`;
            }),
          ),
          "Я напомню об этих задачах в личке.",
        ].join("\n");

        await ctx.reply(response);
      } else {
        // Если задач не найдено, но бот упомянут, можно ответить что-то полезное
        await ctx.reply("Привет! Я обработал сообщение. Используйте команды для работы со мной: /help");
      }

      // Проверяем важность сообщения (уведомления отправляются в личку)
      const importance = await importantMessageService.checkIfImportant(message);
      if (importance.isImportant) {
        try {
          const chatId = toInt(message.recipient.chat_id);
          if (chatId) {
            const members = await this.bot.api.getChatMembers(chatId);
            if (members?.members) {
              await importantMessageService.notifyUsersAboutImportantMessage(
                message,
                members.members
                  .map((m) => {
                    const userId = toInt(m.user_id);
                    return userId ? { user_id: userId } : null;
                  })
                  .filter((m): m is { user_id: number } => m !== null),
                this.bot.api,
              );
            }
          }
        } catch (error) {
          logger.warn("Не удалось уведомить пользователей о важном сообщении", {
            location: "App.handleIncomingMessage",
            error,
          });
        }
      }
    } catch (error) {
      logger.error("Не удалось обработать задачи из сообщения", {
        location: "App.handleIncomingMessage",
        error,
      });
    }
  }

  private getHelpText(): string {
    return [
      "🧠 Бот для продуктивности в MAX:",
      "",
      "",
      "📋 Управление чатами:",
      "",
      "/chats — список ваших чатов",
      "",
      "/select_chat <номер> — выбрать чат для работы",
      "",
      "/sync_chats — синхронизировать чаты из MAX",
      "",
      "📊 Дайджесты:",
      "",
      "/digest [дата|период] — дайджест обсуждений в чате",
      "",
      "Примеры: /digest, /digest 2024-01-15, /digest 2024-01-01 2024-01-07",
      "",
      "📅 Дедлайны и задачи:",
      "",
      "/deadlines — дедлайны на ближайшую неделю",
      "",
      "/tasks — все задачи в чате",
      "",
      "/calendar — экспорт дедлайнов в календарь (.ics)",
      "",
      "🔍 Поиск:",
      "",
      "/search <запрос> — поиск по материалам и сообщениям",
      "",
      "/materials — все материалы из чата",
      "",
      "💬 В личных сообщениях можно задавать вопросы:",
      "",
      "• «какие дедлайны завтра?»",
      "",
      "• «какие материалы к экзамену?»",
      "",
      "• «есть задачи на завтра?»",
      "",
      "Используйте кнопки ниже для быстрого доступа к функциям!",
    ].join("\n");
  }

  private async handleHelpCommand(ctx: CommandContext) {
    const userId = toInt(ctx.user?.user_id);
    try {
      const text = this.getHelpText();
      const isPersonal = ctx.message?.recipient?.chat_type === "dialog";
      
      // Получаем информацию об активном чате для отображения в меню
      const activeChat = userId ? await this.getActiveChatInfo(userId) : null;
      const keyboard = keyboardService.getMainMenu(activeChat?.title ?? null);
      
      if (isPersonal) {
        const senderUserId = toInt(ctx.message?.sender?.user_id);
        if (senderUserId) {
          await this.bot.api.sendMessageToUser(senderUserId, text, { attachments: [keyboard] });
        } else {
          logger.warn("Не найден userId, используется ctx.reply", {
            location: "handleHelpCommand",
          });
          await ctx.reply(text, { attachments: [keyboard] });
        }
      } else {
        await ctx.reply(text, { attachments: [keyboard] });
      }
      logger.success("Справка отправлена", { userId });
    } catch (error) {
      logger.error("Ошибка отправки справки", {
        userId,
        action: "help",
        location: "handleHelpCommand",
        error,
      });
      throw error;
    }
  }

  /**
   * Получает ID чата для команды:
   * - Если команда из группового чата, использует этот чат
   * - Если команда из личного чата, использует выбранный активный чат
   * - Автоматически добавляет групповой чат в список пользователя при первом использовании
   */
  private async getChatIdForCommand(ctx: CommandContext): Promise<number | null> {
    const userId = toInt(ctx.user?.user_id);
    const isPersonal = ctx.message.recipient.chat_type === "dialog";
    
    // If command is from a group chat, use that chat and auto-add to user's list
    const contextChatId = toInt(ctx.chatId);
    if (contextChatId && !isPersonal) {
      // Auto-add group chat to user's list if not already there
      if (userId) {
        try {
          const chatTitle = ctx.chat?.title ?? undefined;
          await userChatService.addChat(userId, contextChatId, chatTitle);
          // Auto-select this chat as active
          await userChatService.selectChat(userId, contextChatId);
        } catch (error) {
          logger.warn("Не удалось автоматически добавить/выбрать чат", {
            userId,
            chatId: contextChatId,
            location: "getChatIdForCommand",
            error,
          });
        }
      }
      return contextChatId;
    }

    // If command is from personal chat, use selected chat
    if (!userId) {
      return null;
    }

    const selectedChatId = await userChatService.getSelectedChat(userId);
    if (selectedChatId) {
      const numericChatId = toInt(selectedChatId);
      return numericChatId ?? null;
    }

    return null;
  }

  /**
   * Получает информацию о текущем активном чате для пользователя
   */
  private async getActiveChatInfo(userId: number): Promise<{ id: string; title: string | null } | null> {
    const selectedChatId = await userChatService.getSelectedChat(userId);
    if (!selectedChatId) {
      return null;
    }

    const userChats = await userChatService.getUserChats(userId);
    const selectedChat = userChats.find((c: { chatId: string }) => c.chatId === selectedChatId);
    
    return selectedChat
      ? { id: selectedChatId, title: selectedChat.chatTitle }
      : { id: selectedChatId, title: null };
  }

  private async handleDigestCommand(ctx: CommandContext) {
    try {
      const userId = toInt(ctx.user?.user_id);
      logger.command(userId ?? undefined, "digest", ctx.chatId);
      
      // Извлекаем аргументы команды - все что после "/digest "
      const fullText = ctx.message.body.text ?? "";
      const argsText = fullText.replace(/^\/digest\s+/i, "").trim();
      const rawArgs = argsText ? argsText.split(/\s+/) : [];
      const range = this.resolveRange(rawArgs);

      if (!range) {
        await ctx.reply(
          "Не понял период. Используйте: /digest сегодня|вчера|неделя|2025-11-01|2025-11-01:2025-11-03",
        );
        return;
      }

      const chatId = await this.getChatIdForCommand(ctx);
      
      if (!chatId) {
        const userId = toInt(ctx.user?.user_id);
        const isPersonal = ctx.message?.recipient?.chat_type === "dialog";
        
        if (isPersonal && userId) {
          const text = [
            "❌ Активный чат не выбран.",
            "",
            "Выберите чат для работы:",
            "• Используйте /chats для просмотра списка чатов",
            "• Используйте кнопку '📋 Мои чаты' в главном меню",
            "• Или вызовите команду из нужного группового чата",
          ].join("\n");
          
          await ctx.reply(text, { attachments: [keyboardService.getChatsMenu()] });
        } else {
          await ctx.reply(
            "Не удалось определить чат. Используйте /select_chat для выбора чата или вызовите команду из нужного чата.",
          );
        }
        return;
      }

      const chatTitle = ctx.chat?.title ?? "Учебный чат";
      const audienceId = toInt(ctx.user?.user_id);
      const digestOptions = audienceId ? { audienceUserId: audienceId } : undefined;
      
      logger.userAction(userId ?? undefined, "Генерация дайджеста", { chatId, chatTitle });
      const summary = await digestService.generateDigest(chatId, chatTitle, range, digestOptions ?? {}, this.bot.api);
      
      // Отправляем дайджест с markdown форматированием
      await ctx.reply(summary, { format: "markdown" });
      logger.success("Дайджест сгенерирован и отправлен", { userId, chatId: String(chatId) });
    } catch (error) {
      logger.error("Ошибка генерации дайджеста", {
        userId: toInt(ctx.user?.user_id),
        action: "digest",
        location: "handleDigestCommand",
        error,
      });
      await ctx.reply("Произошла ошибка при генерации дайджеста. Попробуйте позже.");
    }
  }

  private async handleDeadlinesCommand(ctx: CommandContext) {
    const chatId = await this.getChatIdForCommand(ctx);
    if (!chatId) {
      const userId = toInt(ctx.user?.user_id);
      const isPersonal = ctx.message?.recipient?.chat_type === "dialog";
      
      if (isPersonal && userId) {
        const text = [
          "❌ Активный чат не выбран.",
          "",
          "Выберите чат для работы:",
          "• Используйте /chats для просмотра списка чатов",
          "• Используйте кнопку '📋 Мои чаты' в главном меню",
          "• Или вызовите команду из нужного группового чата",
        ].join("\n");
        
        await ctx.reply(text, { attachments: [keyboardService.getChatsMenu()] });
      } else {
        await ctx.reply(
          "Не удалось определить чат. Используйте /select_chat для выбора чата или вызовите команду из нужного чата.",
        );
      }
      return;
    }

    const tasks = await taskService.getUpcomingTasks(chatId, addDays(new Date(), 7));
    if (tasks.length === 0) {
      const text = "На ближайшую неделю дедлайнов не найдено.";
      // Если это callback, обновляем сообщение
      if (ctx.update?.update_type === "message_callback") {
        await ctx.answerOnCallback({
          message: { text, attachments: [keyboardService.getBackMenu()] },
        });
      } else {
        await ctx.reply(text);
      }
      return;
    }

    const summary = formatBulletList(
      tasks.map((task) => {
        const parts = [task.title];
        if (task.dueDate) parts.push(`дедлайн ${formatDate(task.dueDate)}`);
        if (task.assigneeName) parts.push(`ответственный: ${task.assigneeName}`);
        return parts.join(" — ");
      }),
    );

    const text = `📌 Дедлайны на ближайшую неделю:\n\n${summary}`;

    // Если это callback, обновляем сообщение
    if (ctx.update?.update_type === "message_callback") {
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getBackMenu()] },
      });
    } else {
      await ctx.reply(text);
    }
  }

  private async handleCalendarCommand(ctx: CommandContext) {
    const userId = toInt(ctx.user?.user_id);
    if (!userId) {
      await ctx.reply("Команда доступна только авторизованным пользователям.");
      return;
    }

    try {
      // Получаем задачи пользователя из всех чатов
      const userTasks = await taskService.getPersonalTasks(userId, addDays(new Date(), 60));
      
      if (userTasks.length === 0) {
        await ctx.reply(
          "📅 У вас пока нет задач с дедлайнами.\n\nЗадачи будут автоматически добавлены в календарь, когда появятся дедлайны в чатах.",
          { attachments: [keyboardService.getBackMenu()] }
        );
        return;
      }

      // Группируем задачи по датам
      const tasksByDate = new Map<string, typeof userTasks>();
      userTasks.forEach((task) => {
        if (task.dueDate) {
          const dateStr = formatDate(task.dueDate, "Europe/Moscow");
          const dateKey = dateStr.split(" ")[0] ?? dateStr; // Только дата
          if (!tasksByDate.has(dateKey)) {
            tasksByDate.set(dateKey, []);
          }
          tasksByDate.get(dateKey)!.push(task);
        }
      });

      // Формируем календарь
      const calendarText: string[] = [];
      calendarText.push("📅 **Ваш календарь дедлайнов:**\n");
      
      // Сортируем даты
      const sortedDates = Array.from(tasksByDate.keys()).sort();
      
      sortedDates.forEach((dateKey) => {
        const tasks = tasksByDate.get(dateKey)!;
        calendarText.push(`\n**${dateKey}:**`);
        tasks.forEach((task) => {
          const parts = [task.title];
          if (task.dueDate) {
            const dateStr = formatDate(task.dueDate, "Europe/Moscow");
            const timePart = dateStr.split(" ");
            if (timePart.length > 1 && timePart[1]) {
              parts.push(`в ${timePart[1]}`);
            }
          }
          if (task.assigneeName && task.assigneeName !== task.createdByName) {
            parts.push(`(ответственный: ${task.assigneeName})`);
          }
          calendarText.push(`• ${parts.join(" — ")}`);
        });
      });

      calendarText.push(`\n\n**Всего задач:** ${userTasks.length}`);
      calendarText.push(`\n**Ближайший дедлайн:** ${formatDate(userTasks[0]?.dueDate ?? new Date(), "Europe/Moscow")}`);

      // Пытаемся экспортировать в ICS
      const calendar = await calendarService.exportUserCalendar(userId);
      
      if (calendar) {
        calendarText.push(`\n\n💡 *Календарь можно экспортировать в формате ICS через мини-приложение.*`);
      }

      await ctx.reply(calendarText.join("\n"), { 
        format: "markdown",
        attachments: [keyboardService.getCalendarMenu()] 
      });
    } catch (error) {
      logger.error("Ошибка генерации календаря", {
        userId,
        location: "handleCalendarCommand",
        error,
      });
      await ctx.reply("Произошла ошибка при генерации календаря. Попробуйте позже.");
    }
  }

  private async handleSearchCommand(ctx: CommandContext) {
    const userId = toInt(ctx.user?.user_id);
    logger.command(userId ?? undefined, "search", ctx.chatId);
    
    const chatId = await this.getChatIdForCommand(ctx);
    if (!chatId) {
      const isPersonal = ctx.message?.recipient?.chat_type === "dialog";
      
      if (isPersonal && userId) {
        const text = [
          "❌ Активный чат не выбран.",
          "",
          "Выберите чат для работы:",
          "• Используйте /chats для просмотра списка чатов",
          "• Используйте кнопку '📋 Выбрать чат' в главном меню",
          "• Или вызовите команду из нужного группового чата",
        ].join("\n");
        
        await ctx.reply(text, { attachments: [keyboardService.getChatsMenu()] });
      } else {
        await ctx.reply(
          "Не удалось определить чат. Используйте /select_chat для выбора чата или вызовите команду из нужного чата.",
        );
      }
      return;
    }

    // Извлекаем аргументы команды - все что после "/search "
    const fullText = ctx.message.body.text ?? "";
    const query = fullText.replace(/^\/search\s+/i, "").trim();

    if (!query) {
      await ctx.reply(
        "🔍 Поиск по материалам и сообщениям",
        {
          attachments: [keyboardService.getBackMenu()],
        }
      );
      return;
    }

    try {
      // Выполняем поиск параллельно
      const [materials, messages] = await Promise.all([
        searchService.searchMaterials(chatId, query, 10),
        searchService.searchMessages(chatId, query, 10),
      ]);

      if (materials.length === 0 && messages.length === 0) {
        await ctx.reply(
          `По запросу «${query}» ничего не найдено.\n\nПопробуйте изменить запрос или проверьте, что выбран правильный чат.`,
          { attachments: [keyboardService.getBackMenu()] }
        );
        return;
      }

      const results: string[] = [];
      results.push(`🔍 Результаты поиска: «${query}»\n`);

      if (materials.length > 0) {
        results.push(`📎 Материалы (${materials.length}):`);
        materials.forEach((m, index) => {
          const title = m.title.length > 60 ? `${m.title.substring(0, 60)}...` : m.title;
          // Если есть ссылка, делаем название кликабельной ссылкой в Markdown
          if (m.link) {
            // Убеждаемся, что ссылка имеет протокол
            let linkUrl = m.link.trim();
            if (!linkUrl.startsWith("http://") && !linkUrl.startsWith("https://")) {
              linkUrl = `https://${linkUrl}`;
            }
            results.push(`${index + 1}. [**${title}**](${linkUrl})`);
          } else {
            results.push(`${index + 1}. **${title}**`);
          }
          
          // Добавляем краткую сводку, если есть
          if (m.description) {
            const desc = m.description.length > 100 ? `${m.description.substring(0, 100)}...` : m.description;
            results.push(`   ${desc}`);
          }
        });
        results.push("");
      }

      if (messages.length > 0) {
        results.push(`💬 Сообщения (${messages.length}):`);
        messages.forEach((m, index) => {
          const text = sanitizeText(m.text ?? "");
          const preview = text.length > 80 ? `${text.substring(0, 80)}...` : text;
          const sender = m.senderName ?? "Участник";
          const date = formatDate(m.timestamp);
          results.push(`${index + 1}. ${sender} (${date}):`);
          results.push(`   ${preview}`);
        });
      }

      await ctx.reply(results.join("\n"), { attachments: [keyboardService.getBackMenu()], format: "markdown" });
      logger.userAction(userId ?? undefined, "Выполнен поиск", { chatId, query });
    } catch (error) {
      logger.error("Ошибка выполнения поиска", {
        userId,
        chatId,
        query,
        location: "handleSearchCommand",
        error,
      });
      await ctx.reply("Произошла ошибка при выполнении поиска. Попробуйте позже.");
    }
  }

  private async handleMaterialsCommand(ctx: CommandContext) {
    const chatId = await this.getChatIdForCommand(ctx);
    if (!chatId) {
      const userId = toInt(ctx.user?.user_id);
      const isPersonal = ctx.message?.recipient?.chat_type === "dialog";
      
      if (isPersonal && userId) {
        const text = [
          "❌ Активный чат не выбран.",
          "",
          "Выберите чат для работы:",
          "• Используйте /chats для просмотра списка чатов",
          "• Используйте кнопку '📋 Мои чаты' в главном меню",
          "• Или вызовите команду из нужного группового чата",
        ].join("\n");
        
        await ctx.reply(text, { attachments: [keyboardService.getChatsMenu()] });
      } else {
        await ctx.reply(
          "Не удалось определить чат. Используйте /select_chat для выбора чата или вызовите команду из нужного чата.",
        );
      }
      return;
    }

    const materials = await searchService.getAllMaterials(chatId, 30);
    if (materials.length === 0) {
      const text = "В чате пока нет материалов.";
      // Если это callback, обновляем сообщение
      if (ctx.update?.update_type === "message_callback") {
        await ctx.answerOnCallback({
          message: { text, attachments: [keyboardService.getBackMenu()] },
        });
      } else {
        await ctx.reply(text);
      }
      return;
    }

    // Используем функцию форматирования материалов для единообразия
    const formattedMaterials = formatMaterials(materials);

    const text = [
      `📎 Материалы из чата (${materials.length}):`,
      "",
      formattedMaterials,
    ].join("\n");

    // Если это callback, обновляем сообщение
    if (ctx.update?.update_type === "message_callback") {
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getBackMenu()], format: "markdown" },
      });
    } else {
      await ctx.reply(text, { format: "markdown" });
    }
  }

  private async handleTasksCommand(ctx: CommandContext) {
    const chatId = await this.getChatIdForCommand(ctx);
    if (!chatId) {
      await ctx.reply(
        "Не удалось определить чат. Используйте /select_chat для выбора чата или вызовите команду из нужного чата.",
      );
      return;
    }

    const tasks = await taskService.getAllTasks(chatId, 30);
    if (tasks.length === 0) {
      await ctx.reply("В чате пока нет задач.");
      return;
    }

    await ctx.reply(
      [
        `📋 Задачи в чате (${tasks.length}):`,
        formatBulletList(
          tasks.map((task) => {
            const parts = [task.title];
            if (task.dueDate) {
              parts.push(`дедлайн ${formatDate(task.dueDate)}`);
            }
            if (task.assigneeName) {
              parts.push(`ответственный: ${task.assigneeName}`);
            }
            return parts.join(" — ");
          }),
        ),
      ].join("\n"),
    );
  }


  private async handleChatsCommand(ctx: CommandContext) {
    const userId = toInt(ctx.user?.user_id);
    if (!userId) {
      await ctx.reply("Команда доступна только авторизованным пользователям.");
      return;
    }

    const userChats = await userChatService.getUserChats(userId);
    const selectedChatId = await userChatService.getSelectedChat(userId);

    if (userChats.length === 0) {
      await ctx.reply(
        [
          "У вас пока нет добавленных чатов.",
          "",
          "Используйте /sync_chats для синхронизации чатов из MAX или добавьте чат вручную.",
        ].join("\n"),
        { attachments: [keyboardService.getChatsMenu()] },
      );
      return;
    }

    const chatList = userChats.map((chat: { chatId: string; chatTitle: string | null }, index: number) => {
      const isSelected = chat.chatId === selectedChatId;
      const marker = isSelected ? "✅" : `${index + 1}.`;
      return `${marker} ${chat.chatTitle ?? `Чат ${chat.chatId}`}${isSelected ? " (выбран)" : ""}`;
    });

    // Создаем кнопки для выбора чата
    const chats = userChats.map((chat: { chatId: string; chatTitle: string | null }) => ({
      id: Number.parseInt(chat.chatId, 10),
      title: chat.chatTitle ?? `Чат ${chat.chatId}`,
    }));

    const selectedChatIdNum = selectedChatId ? Number.parseInt(selectedChatId, 10) : undefined;

    const text = [
      "📋 Ваши чаты:",
      "",
      formatBulletList(chatList),
      "",
      "Выберите чат кнопкой ниже или используйте /select_chat <номер>.",
    ].join("\n");

    await ctx.reply(text, {
      attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum)],
    });
  }

  private async handleSelectChatCommand(ctx: CommandContext) {
    const userId = toInt(ctx.user?.user_id);
    if (!userId) {
      await ctx.reply("Команда доступна только авторизованным пользователям.");
      return;
    }

    const args = ctx.message.body.text?.split(" ").slice(1) ?? [];
    const chatNumberOrId = args[0];

    if (!chatNumberOrId) {
      // Show list of chats
      await this.handleChatsCommand(ctx);
      await ctx.reply(
        "\nИспользуйте: /select_chat <номер> или /select_chat <chat_id> для выбора чата.",
      );
      return;
    }

    // Try to parse as number (index) or chat ID
    const chatIndex = Number.parseInt(chatNumberOrId, 10);
    const userChats = await userChatService.getUserChats(userId);

    let selectedChat;
    if (!Number.isNaN(chatIndex) && chatIndex > 0 && chatIndex <= userChats.length) {
      // Select by index
      selectedChat = userChats[chatIndex - 1];
    } else {
      // Try to find by chat ID
      const chatId = ensureIdString(chatNumberOrId);
      selectedChat = userChats.find((c: { chatId: string }) => c.chatId === chatId);
    }

    if (!selectedChat) {
      await ctx.reply("Чат не найден. Используйте /chats для просмотра списка чатов.");
      return;
    }

    try {
      await userChatService.selectChat(userId, selectedChat.chatId);
      await ctx.reply(
        `✅ Выбран чат: ${selectedChat.chatTitle ?? `Чат ${selectedChat.chatId}`}`,
      );
    } catch (error) {
      logger.error("Ошибка выбора чата", {
        userId,
        action: "select_chat",
        location: "handleSelectChatCommand",
        error,
      });
      await ctx.reply("Не удалось выбрать чат. Попробуйте позже.");
    }
  }

  private async handleSyncChatsCommand(ctx: CommandContext) {
    const userId = toInt(ctx.user?.user_id);
    if (!userId) {
      await ctx.reply("Команда доступна только авторизованным пользователям.");
      return;
    }

    try {
      await ctx.reply("Синхронизирую список чатов...");
      const count = await userChatService.syncChatsFromMax(userId, {
        getAllChats: async () => {
          const response = await this.bot.api.getAllChats();
          return {
            chats: response.chats?.map((chat) => ({
              chat_id: toInt(chat.chat_id) ?? 0,
              title: chat.title ?? undefined,
            })),
          };
        },
        getChatMembers: async (chatId: number, user_ids: number[]) => {
          try {
            const membersResponse = await this.bot.api.getChatMembers(chatId, { user_ids });
            return membersResponse;
          } catch (error) {
            // Если пользователь не является участником чата, API вернет ошибку
            // Пользователь не является участником чата - это нормально, не логируем
            return { members: [] };
          }
        },
      });
      await ctx.reply(`✅ Синхронизировано ${count} чатов. Используйте /chats для просмотра списка.`);
    } catch (error) {
      logger.error("Ошибка синхронизации чатов", {
        userId,
        action: "sync_chats",
        location: "handleSyncChatsCommand",
        error,
      });
      await ctx.reply("Не удалось синхронизировать чаты. Попробуйте позже.");
    }
  }

  private resolveRange(args: string[]): { from: Date; to: Date } | null {
    const arg = args.join(" ").toLowerCase().trim();
    if (!arg) {
      const from = startOfDay();
      const to = endOfDay();
      return { from, to };
    }

    // Используем chrono-node для парсинга дат
    const chrono = require("chrono-node");
    const now = new Date();
    
    // Специальные случаи
    if (arg === "сегодня" || arg === "today") {
      return { from: startOfDay(), to: endOfDay() };
    }

    if (arg === "вчера" || arg === "yesterday") {
      const yesterday = addDays(new Date(), -1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }

    if (arg === "неделя" || arg === "week") {
      return { from: startOfWeek(), to: endOfWeek() };
    }

    // Парсинг диапазона через ":"
    if (arg.includes(":")) {
      const parts = arg.split(":").map(p => p.trim());
      if (parts.length === 2) {
        const fromParsed = chrono.parseDate(parts[0], now);
        const toParsed = chrono.parseDate(parts[1], now);
        if (fromParsed && toParsed) {
          return { from: startOfDay(fromParsed), to: endOfDay(toParsed) };
        }
      }
    }

    // Парсинг одной даты
    const parsed = chrono.parseDate(arg, now);
    if (parsed) {
      return { from: startOfDay(parsed), to: endOfDay(parsed) };
    }

    // Попытка парсить как ISO дату (YYYY-MM-DD)
    const isoDate = /^(\d{4}-\d{2}-\d{2})$/.exec(arg);
    if (isoDate) {
      const date = new Date(`${isoDate[1]}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        return { from: startOfDay(date), to: endOfDay(date) };
      }
    }

    return null;
  }

  private readonly handleReminder: ReminderHandler = async (task, reminder) => {
    const userId = reminder.userId ?? task.assigneeId ?? task.createdByUserId;
    const messageLines = [
      "⏰ Напоминание о задаче:",
      task.title,
      task.dueDate ? `Дедлайн: ${formatDate(task.dueDate)}` : "Срок не указан.",
      task.description ? `Описание: ${task.description}` : "",
      `Источник сообщения: ${task.sourceMessageId}`,
    ].filter(Boolean);

    try {
      if (userId) {
        const numericUserId = toInt(userId);
        if (!numericUserId) {
          logger.error("Не удалось преобразовать userId в число для напоминания", {
            userId: String(userId),
            location: "handleReminder",
            error: new Error("Invalid userId"),
          });
          return;
        }
        await this.bot.api.sendMessageToUser(numericUserId, messageLines.join("\n"));
      } else {
        const numericChatId = toInt(task.chatId);
        if (!numericChatId) {
          logger.error("Не удалось преобразовать chatId в число для напоминания", {
            chatId: task.chatId,
            location: "handleReminder",
            error: new Error("Invalid chatId"),
          });
          return;
        }
        await this.bot.api.sendMessageToChat(numericChatId, messageLines.join("\n"));
      }
    } catch (error) {
      logger.error("Ошибка отправки напоминания", {
        location: "handleReminder",
        taskId: task.id,
        userId: task.createdByUserId ?? undefined,
        error,
      });
    }
  };

  /**
   * Регистрация обработчиков для callback кнопок
   */
  private registerButtonHandlers() {
    // Обработчик кнопки "Начать" (start button)
    // В MAX API кнопка "Начать" может отправлять callback с action "start" или payload в событии bot_started
    // Обрабатываем оба варианта: "start" и "action:start"
    this.bot.action("start", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      await preferenceService.getOrCreate(userId);
      
      // Получаем имя пользователя
      const userName = ctx.user?.name ?? "друг";
      
      // Получаем информацию об активном чате
      const activeChat = await this.getActiveChatInfo(userId);
      
      const welcomeText = [
        `Привет, ${userName}! 👋`,
        "",
        "Я — твой персональный AI-агент по аналитике чатов для MAX.",
        "",
        activeChat
          ? `✅ Активный чат: ${activeChat.title ?? `Чат ${activeChat.id}`}`
          : "⚠️ Выберите активный чат для работы (кнопка ниже)",
        "",
        "Используй кнопки ниже для быстрого доступа к функциям:",
        "",
        "💬 В личных сообщениях можно задавать вопросы:",
        "• «какие дедлайны завтра?»",
        "• «какие материалы к экзамену?»",
        "• «есть задачи на завтра?»",
      ].join("\n");
      
      // Подготавливаем вложения: изображение (из кэша) + клавиатура
      const attachments: AttachmentRequest[] = [];
      
      // Используем предзагруженное изображение из кэша
      if (this.welcomeImageToken) {
        try {
          const image = new ImageAttachment({ token: this.welcomeImageToken });
          attachments.push(image.toJson());
        } catch (error) {
          logger.warn("Не удалось использовать кэшированное изображение", {
            userId,
            location: "action:start.welcomeImage",
            error,
          });
        }
      }
      
      // Добавляем клавиатуру
      attachments.push(keyboardService.getMainMenu(activeChat?.title ?? null));
      
      await ctx.answerOnCallback({
        message: { text: welcomeText, attachments },
      });
      
      logger.userAction(userId, "Кнопка 'Начать' нажата", { userName });
    });

    // Обработчик кнопки "Начать" с префиксом "action:"
    this.bot.action("action:start", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      await preferenceService.getOrCreate(userId);
      
      // Получаем имя пользователя
      const userName = ctx.user?.name ?? "друг";
      
      // Получаем информацию об активном чате
      const activeChat = await this.getActiveChatInfo(userId);
      
      const welcomeText = [
        `Привет, ${userName}! 👋`,
        "",
        "Я — твой персональный AI-агент по аналитике чатов для MAX.",
        "",
        activeChat
          ? `✅ Активный чат: ${activeChat.title ?? `Чат ${activeChat.id}`}`
          : "⚠️ Выберите активный чат для работы (кнопка ниже)",
        "",
        "Используй кнопки ниже для быстрого доступа к функциям:",
        "",
        "💬 В личных сообщениях можно задавать вопросы:",
        "• «какие дедлайны завтра?»",
        "• «какие материалы к экзамену?»",
        "• «есть задачи на завтра?»",
      ].join("\n");
      
      // Подготавливаем вложения: изображение (из кэша) + клавиатура
      const attachments: AttachmentRequest[] = [];
      
      // Используем предзагруженное изображение из кэша
      if (this.welcomeImageToken) {
        try {
          const image = new ImageAttachment({ token: this.welcomeImageToken });
          attachments.push(image.toJson());
        } catch (error) {
          logger.warn("Не удалось использовать кэшированное изображение", {
            userId,
            location: "action:action:start.welcomeImage",
            error,
          });
        }
      }
      
      // Добавляем клавиатуру
      attachments.push(keyboardService.getMainMenu(activeChat?.title ?? null));
      
      await ctx.answerOnCallback({
        message: { text: welcomeText, attachments },
      });
      
      logger.userAction(userId, "Кнопка 'Начать' нажата (action:start)", { userName });
    });

    // Главное меню
    this.bot.action("action:main_menu", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      const activeChat = userId ? await this.getActiveChatInfo(userId) : null;
      
      const text = activeChat
        ? `Главное меню\n\n✅ Активный чат: ${activeChat.title ?? `Чат ${activeChat.id}`}`
        : "Главное меню\n\n⚠️ Выберите активный чат для работы";
      
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getMainMenu(activeChat?.title ?? null)] },
      });
    });

    // Помощь
    this.bot.action("action:help", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const activeChat = await this.getActiveChatInfo(userId);
      const helpText = await this.getHelpText();
      
      await ctx.answerOnCallback({
        message: {
          text: helpText,
          attachments: [keyboardService.getMainMenu(activeChat?.title ?? null)],
        },
      });
    });

    // Чаты
    this.bot.action("action:chats", async (ctx) => {
      const text = "📋 Управление чатами:";
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getChatsMenu()] },
      });
    });

    this.bot.action("action:chats_list", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      // Автоматическая синхронизация при входе в раздел чатов
      try {
        // Выполняем синхронизацию
        const syncCount = await userChatService.syncChatsFromMax(userId, {
          getAllChats: async () => {
            const response = await this.bot.api.getAllChats();
            return {
              chats: response.chats?.map((chat) => ({
                chat_id: toInt(chat.chat_id) ?? 0,
                title: chat.title ?? undefined,
              })),
            };
          },
          getChatMembers: async (chatId: number, user_ids: number[]) => {
            const response = await this.bot.api.getChatMembers(chatId, { user_ids });
            return {
              members: response.members?.map((m) => ({ user_id: toInt(m.user_id) ?? 0 })),
            };
          },
        });

        // Получаем обновленный список чатов
        const userChats = await userChatService.getUserChats(userId);
        const selectedChatId = await userChatService.getSelectedChat(userId);

        if (userChats.length === 0) {
          await ctx.answerOnCallback({
            message: {
              text: "У вас пока нет чатов. Чат будет добавлен автоматически, когда вы отправите сообщение в групповой чат.",
              attachments: [keyboardService.getBackMenu()],
            },
          });
          return;
        }

        const chatList = userChats.map((chat: { chatId: string; chatTitle: string | null }, index: number) => {
          const isSelected = chat.chatId === selectedChatId;
          const marker = isSelected ? "✅" : `${index + 1}.`;
          return `${marker} ${chat.chatTitle ?? `Чат ${chat.chatId}`}${isSelected ? " (выбран)" : ""}`;
        });

        const chats = userChats.map((chat: { chatId: string; chatTitle: string | null }) => ({
          id: Number.parseInt(chat.chatId, 10),
          title: chat.chatTitle ?? `Чат ${chat.chatId}`,
        }));

        const selectedChatIdNum = selectedChatId ? Number.parseInt(selectedChatId, 10) : undefined;

        const text = [
          `✅ Синхронизировано ${syncCount} чатов`,
          "",
          "📋 Ваши чаты:",
          "",
          formatBulletList(chatList),
          "",
          "Выберите чат кнопкой ниже:",
        ].join("\n");

        await ctx.answerOnCallback({
          message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum)] },
        });
      } catch (error) {
        logger.error("Ошибка синхронизации чатов", {
          userId,
          location: "action:chats_list",
          error,
        });
        
        // Показываем список чатов даже при ошибке синхронизации
        const userChats = await userChatService.getUserChats(userId);
        const selectedChatId = await userChatService.getSelectedChat(userId);

        if (userChats.length === 0) {
          await ctx.answerOnCallback({
            message: {
              text: "Ошибка синхронизации чатов. Попробуйте позже.",
              attachments: [keyboardService.getBackMenu()],
            },
          });
          return;
        }

        const chatList = userChats.map((chat: { chatId: string; chatTitle: string | null }, index: number) => {
          const isSelected = chat.chatId === selectedChatId;
          const marker = isSelected ? "✅" : `${index + 1}.`;
          return `${marker} ${chat.chatTitle ?? `Чат ${chat.chatId}`}${isSelected ? " (выбран)" : ""}`;
        });

        const chats = userChats.map((chat: { chatId: string; chatTitle: string | null }) => ({
          id: Number.parseInt(chat.chatId, 10),
          title: chat.chatTitle ?? `Чат ${chat.chatId}`,
        }));

        const selectedChatIdNum = selectedChatId ? Number.parseInt(selectedChatId, 10) : undefined;

        const text = [
          "⚠️ Ошибка синхронизации, показаны сохраненные чаты:",
          "",
          "📋 Ваши чаты:",
          "",
          formatBulletList(chatList),
          "",
          "Выберите чат кнопкой ниже:",
        ].join("\n");

        await ctx.answerOnCallback({
          message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum)] },
        });
      }
    });

    this.bot.action("action:sync_chats", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      try {
        // Выполняем синхронизацию напрямую, без создания нового сообщения
        const count = await userChatService.syncChatsFromMax(userId, {
          getAllChats: async () => {
            const response = await this.bot.api.getAllChats();
            return {
              chats: response.chats?.map((chat) => ({
                chat_id: toInt(chat.chat_id) ?? 0,
                title: chat.title ?? undefined,
              })),
            };
          },
          getChatMembers: async (chatId: number, user_ids: number[]) => {
            const response = await this.bot.api.getChatMembers(chatId, { user_ids });
            return {
              members: response.members?.map((m) => ({ user_id: toInt(m.user_id) ?? 0 })),
            };
          },
        });
        
        // После синхронизации обновляем меню чатов
        const userChats = await userChatService.getUserChats(userId);
        const selectedChatId = await userChatService.getSelectedChat(userId);
        
        if (userChats.length > 0) {
          const chatList = userChats.map((chat: { chatId: string; chatTitle: string | null }, index: number) => {
            const isSelected = chat.chatId === selectedChatId;
            const marker = isSelected ? "✅" : `${index + 1}.`;
            return `${marker} ${chat.chatTitle ?? `Чат ${chat.chatId}`}${isSelected ? " (выбран)" : ""}`;
          });

          const chats = userChats.map((chat: { chatId: string; chatTitle: string | null }) => ({
            id: Number.parseInt(chat.chatId, 10),
            title: chat.chatTitle ?? `Чат ${chat.chatId}`,
          }));

          const selectedChatIdNum = selectedChatId ? Number.parseInt(selectedChatId, 10) : undefined;

          const text = [
            `✅ Синхронизировано ${count} чатов.`,
            "",
            "📋 Ваши чаты:",
            "",
            formatBulletList(chatList),
            "",
            "Выберите чат кнопкой ниже:",
          ].join("\n");

          // Обновляем сообщение с новым списком чатов
          await ctx.answerOnCallback({
            message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum)] },
          });
        } else {
          await ctx.answerOnCallback({
            notification: `Синхронизировано ${count} чатов, но у вас нет доступных чатов.`,
          });
        }
      } catch (error) {
        logger.error("Ошибка синхронизации чатов из кнопки", {
          userId: toInt(ctx.user?.user_id),
          location: "registerButtonHandlers.sync_chats",
          error,
        });
        await ctx.answerOnCallback({ notification: "Ошибка при синхронизации чатов" });
      }
    });

    // Обработчик выбора чата по кнопке (поддерживает отрицательные ID)
    this.bot.action(/^action:select_chat:(-?\d+)$/, async (ctx) => {
      const chatIdStr = ctx.match?.[1];
      if (!chatIdStr) {
        await ctx.answerOnCallback({ notification: "Ошибка: не указан ID чата" });
        return;
      }

      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      try {
        // Сохраняем chatId как строку (может быть отрицательным)
        await userChatService.selectChat(userId, chatIdStr);
        const userChats = await userChatService.getUserChats(userId);
        const selectedChat = userChats.find((c: { chatId: string }) => c.chatId === chatIdStr);
        const selectedChatTitle = selectedChat?.chatTitle ?? `Чат ${chatIdStr}`;
        
        // Обновляем меню с выделенным чатом
        const chats = userChats.map((chat: { chatId: string; chatTitle: string | null }) => ({
          id: Number.parseInt(chat.chatId, 10),
          title: chat.chatTitle ?? `Чат ${chat.chatId}`,
        }));

        const chatList = userChats.map((chat: { chatId: string; chatTitle: string | null }, index: number) => {
          const isSelected = chat.chatId === chatIdStr;
          const marker = isSelected ? "✅" : `${index + 1}.`;
          return `${marker} ${chat.chatTitle ?? `Чат ${chat.chatId}`}${isSelected ? " (выбран)" : ""}`;
        });

        const selectedChatIdNum = Number.parseInt(chatIdStr, 10);

        const text = [
          "📋 Ваши чаты:",
          "",
          formatBulletList(chatList),
          "",
          `✅ Активный чат: ${selectedChatTitle}`,
          "",
          "Теперь все команды будут работать с этим чатом!",
        ].join("\n");

        await ctx.answerOnCallback({
          notification: `✅ Выбран чат: ${selectedChatTitle}`,
          message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum)] },
        });
      } catch (error) {
        logger.error("Ошибка выбора чата из кнопки", {
          userId,
          chatId: chatIdStr,
          action: "select_chat",
          location: "registerButtonHandlers.select_chat",
          error,
        });
        await ctx.answerOnCallback({ notification: "Ошибка при выборе чата" });
      }
    });

    this.bot.action("action:select_chat", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const userChats = await userChatService.getUserChats(userId);
      const selectedChatId = await userChatService.getSelectedChat(userId);
      
      if (userChats.length === 0) {
        await ctx.answerOnCallback({
          notification: "У вас нет чатов. Используйте /sync_chats для синхронизации.",
        });
        return;
      }

      const chats = userChats.map((chat: { chatId: string; chatTitle: string | null }) => ({
        id: Number.parseInt(chat.chatId, 10),
        title: chat.chatTitle ?? `Чат ${chat.chatId}`,
      }));

      const selectedChatIdNum = selectedChatId ? Number.parseInt(selectedChatId, 10) : undefined;

      const text = "Выберите чат:";
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum)] },
      });
    });

    // Задачи
    this.bot.action("action:tasks", async (ctx) => {
      const text = "✅ Управление задачами:";
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getTasksMenu()] },
      });
    });

    this.bot.action("action:tasks_list", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          notification: "Не удалось определить чат. Используйте /select_chat",
        });
        return;
      }

      const numericChatId = Number.parseInt(chatId, 10);
      if (Number.isNaN(numericChatId)) {
        await ctx.answerOnCallback({ notification: "Ошибка: неверный ID чата" });
        return;
      }

      const tasks = await taskService.getAllTasks(numericChatId, 30);
      if (tasks.length === 0) {
        await ctx.answerOnCallback({
          message: { text: "В чате пока нет задач.", attachments: [keyboardService.getBackMenu()] },
        });
        return;
      }

      const summary = formatBulletList(
        tasks.map((task) => {
          const parts = [task.title];
          if (task.dueDate) {
            parts.push(`дедлайн ${formatDate(task.dueDate)}`);
          }
          if (task.assigneeName) {
            parts.push(`ответственный: ${task.assigneeName}`);
          }
          return parts.join(" — ");
        }),
      );

      await ctx.answerOnCallback({
        message: {
          text: `📋 Задачи в чате (${tasks.length}):\n\n${summary}`,
          attachments: [keyboardService.getBackMenu()],
        },
      });
    });

    this.bot.action("action:tasks_week", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          notification: "Не удалось определить чат. Используйте /select_chat",
        });
        return;
      }

      const numericChatId = Number.parseInt(chatId, 10);
      if (Number.isNaN(numericChatId)) {
        await ctx.answerOnCallback({ notification: "Ошибка: неверный ID чата" });
        return;
      }

      const tasks = await taskService.getUpcomingTasks(numericChatId, addDays(new Date(), 7));
      if (tasks.length === 0) {
        await ctx.answerOnCallback({ notification: "На неделю задач не найдено" });
        return;
      }

      const summary = formatBulletList(
        tasks.map((task) => {
          const parts = [task.title];
          if (task.dueDate) parts.push(`дедлайн ${formatDate(task.dueDate)}`);
          if (task.assigneeName) parts.push(`ответственный: ${task.assigneeName}`);
          return parts.join(" — ");
        }),
      );

      await ctx.answerOnCallback({
        message: { text: `📅 Задачи на неделю:\n\n${summary}`, attachments: [keyboardService.getBackMenu()] },
      });
    });

    this.bot.action("action:tasks_tomorrow", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          notification: "Не удалось определить чат. Используйте /select_chat",
        });
        return;
      }

      const numericChatId = Number.parseInt(chatId, 10);
      if (Number.isNaN(numericChatId)) {
        await ctx.answerOnCallback({ notification: "Ошибка: неверный ID чата" });
        return;
      }

      const tomorrow = addDays(new Date(), 1);
      const tasks = await taskService.getUpcomingTasks(numericChatId, endOfDay(tomorrow));
      if (tasks.length === 0) {
        await ctx.answerOnCallback({ notification: "На завтра задач не найдено" });
        return;
      }

      const summary = formatBulletList(
        tasks.map((task) => {
          const parts = [task.title];
          if (task.dueDate) parts.push(`дедлайн ${formatDate(task.dueDate)}`);
          if (task.assigneeName) parts.push(`ответственный: ${task.assigneeName}`);
          return parts.join(" — ");
        }),
      );

      await ctx.answerOnCallback({
        message: { text: `📅 Задачи на завтра:\n\n${summary}`, attachments: [keyboardService.getBackMenu()] },
      });
    });


    // Дедлайны
    this.bot.action("action:deadlines", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          notification: "Не удалось определить чат. Используйте /select_chat",
        });
        return;
      }

      const numericChatId = Number.parseInt(chatId, 10);
      if (Number.isNaN(numericChatId)) {
        await ctx.answerOnCallback({ notification: "Ошибка: неверный ID чата" });
        return;
      }

      const tasks = await taskService.getUpcomingTasks(numericChatId, addDays(new Date(), 7));
      if (tasks.length === 0) {
        await ctx.answerOnCallback({
          message: { text: "На ближайшую неделю дедлайнов не найдено.", attachments: [keyboardService.getBackMenu()] },
        });
        return;
      }

      const summary = formatBulletList(
        tasks.map((task) => {
          const parts = [task.title];
          if (task.dueDate) parts.push(`дедлайн ${formatDate(task.dueDate)}`);
          if (task.assigneeName) parts.push(`ответственный: ${task.assigneeName}`);
          return parts.join(" — ");
        }),
      );

      await ctx.answerOnCallback({
        message: { text: `📌 Дедлайны на ближайшую неделю:\n\n${summary}`, attachments: [keyboardService.getBackMenu()] },
      });
    });

    // Материалы
    this.bot.action("action:materials", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          notification: "Не удалось определить чат. Используйте /select_chat",
        });
        return;
      }

      const numericChatId = Number.parseInt(chatId, 10);
      if (Number.isNaN(numericChatId)) {
        await ctx.answerOnCallback({ notification: "Ошибка: неверный ID чата" });
        return;
      }

      const materials = await searchService.getAllMaterials(numericChatId, 30);
      if (materials.length === 0) {
        await ctx.answerOnCallback({
          message: { text: "В чате пока нет материалов.", attachments: [keyboardService.getBackMenu()] },
        });
        return;
      }

      // Используем функцию форматирования материалов для единообразия
      const formattedMaterials = formatMaterials(materials);

      const text = [
        `📎 Материалы из чата (${materials.length}):`,
        "",
        formattedMaterials,
      ].join("\n");

      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getBackMenu()], format: "markdown" },
      });
    });

    // Дайджест
    this.bot.action("action:digest", async (ctx) => {
      const text = "📊 Дайджест обсуждений:";
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getDigestMenu()] },
      });
    });

    this.bot.action("action:digest_period", async (ctx) => {
      await ctx.answerOnCallback({
        message: {
          text: [
            "📊 Дайджест за период",
            "",
            "Используйте команду /digest с указанием периода:",
            "",
            "Примеры:",
            "• /digest 2025-11-01",
            "• /digest 2025-11-01:2025-11-03",
            "• /digest сегодня",
            "• /digest вчера",
            "• /digest неделя",
            "",
            "Или используйте кнопки выше для быстрого доступа.",
          ].join("\n"),
          attachments: [keyboardService.getDigestMenu()],
        },
      });
    });

    this.bot.action("action:digest_today", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          notification: "Не удалось определить чат. Используйте /select_chat",
        });
        return;
      }

      const numericChatId = Number.parseInt(chatId, 10);
      if (Number.isNaN(numericChatId)) {
        await ctx.answerOnCallback({ notification: "Ошибка: неверный ID чата" });
        return;
      }

      const today = new Date();
      const fromDate = startOfDay(today);
      const toDate = endOfDay(today);
      
      // Get chat title
      const userChats = await userChatService.getUserChats(userId);
      const selectedChat = userChats.find((c: { chatId: string }) => c.chatId === chatId);
      const chatTitle = selectedChat?.chatTitle ?? `Чат ${chatId}`;
      
      const digest = await digestService.generateDigest(numericChatId, chatTitle, { from: fromDate, to: toDate }, {}, this.bot.api);
      if (!digest) {
        await ctx.answerOnCallback({ notification: "Дайджест за сегодня пуст" });
        return;
      }

      await ctx.answerOnCallback({
        message: { text: digest, attachments: [keyboardService.getBackMenu()] },
      });
    });

    this.bot.action("action:digest_week", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          notification: "Не удалось определить чат. Используйте /select_chat",
        });
        return;
      }

      const numericChatId = Number.parseInt(chatId, 10);
      if (Number.isNaN(numericChatId)) {
        await ctx.answerOnCallback({ notification: "Ошибка: неверный ID чата" });
        return;
      }

      const now = new Date();
      const fromDate = startOfWeek(now);
      const toDate = endOfWeek(now);
      
      // Get chat title
      const userChats = await userChatService.getUserChats(userId);
      const selectedChat = userChats.find((c: { chatId: string }) => c.chatId === chatId);
      const chatTitle = selectedChat?.chatTitle ?? `Чат ${chatId}`;
      
      const digest = await digestService.generateDigest(numericChatId, chatTitle, { from: fromDate, to: toDate }, {}, this.bot.api);
      if (!digest) {
        await ctx.answerOnCallback({ notification: "Дайджест за неделю пуст" });
        return;
      }

      await ctx.answerOnCallback({
        message: { text: digest, attachments: [keyboardService.getBackMenu()] },
      });
    });

    // Календарь
    this.bot.action("action:calendar", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      try {
        // Получаем задачи пользователя из всех чатов
        const userTasks = await taskService.getPersonalTasks(userId, addDays(new Date(), 60));
        
        if (userTasks.length === 0) {
          await ctx.answerOnCallback({
            message: {
              text: "📅 У вас пока нет задач с дедлайнами.\n\nЗадачи будут автоматически добавлены в календарь, когда появятся дедлайны в чатах.",
              attachments: [keyboardService.getBackMenu()],
            },
          });
          return;
        }

        // Группируем задачи по датам
        const tasksByDate = new Map<string, typeof userTasks>();
        userTasks.forEach((task) => {
          if (task.dueDate) {
            const dateStr = formatDate(task.dueDate, "Europe/Moscow");
            const dateKey = dateStr.split(" ")[0] ?? dateStr; // Только дата
            if (!tasksByDate.has(dateKey)) {
              tasksByDate.set(dateKey, []);
            }
            tasksByDate.get(dateKey)!.push(task);
          }
        });

        // Формируем календарь
        const calendarText: string[] = [];
        calendarText.push("📅 **Ваш календарь дедлайнов:**\n");
        
        // Сортируем даты
        const sortedDates = Array.from(tasksByDate.keys()).sort();
        
        sortedDates.forEach((dateKey) => {
          const tasks = tasksByDate.get(dateKey)!;
          calendarText.push(`\n**${dateKey}:**`);
          tasks.forEach((task) => {
            const parts = [task.title];
            if (task.dueDate) {
              const dateStr = formatDate(task.dueDate, "Europe/Moscow");
              const timePart = dateStr.split(" ");
              if (timePart.length > 1 && timePart[1]) {
                parts.push(`в ${timePart[1]}`);
              }
            }
            if (task.assigneeName && task.assigneeName !== task.createdByName) {
              parts.push(`(ответственный: ${task.assigneeName})`);
            }
            calendarText.push(`• ${parts.join(" — ")}`);
          });
        });

        calendarText.push(`\n\n**Всего задач:** ${userTasks.length}`);
        calendarText.push(`\n**Ближайший дедлайн:** ${formatDate(userTasks[0]?.dueDate ?? new Date(), "Europe/Moscow")}`);
        calendarText.push(`\n\n💡 Используйте кнопку ниже для экспорта в Excel.`);

        await ctx.answerOnCallback({
          message: { 
            text: calendarText.join("\n"), 
            format: "markdown",
            attachments: [keyboardService.getCalendarMenu()] 
          },
        });
      } catch (error) {
        logger.error("Ошибка генерации календаря", {
          userId: toInt(ctx.user?.user_id),
          location: "action:calendar",
          error,
        });
        await ctx.answerOnCallback({ 
          notification: "Произошла ошибка при генерации календаря. Попробуйте позже." 
        });
      }
    });

    // Экспорт календаря в Excel
    this.bot.action("action:calendar_export_excel", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      try {
        await ctx.answerOnCallback({ notification: "Генерирую Excel файл..." });

        const excelResult = await calendarService.exportUserCalendarToExcel(userId);
        
        if (!excelResult) {
          await ctx.answerOnCallback({
            message: {
              text: "Не нашёл задач, которые можно экспортировать в Excel.",
              attachments: [keyboardService.getBackMenu()],
            },
          });
          return;
        }

        // Создаем временный файл с правильным именем
        const tempFilePath = join(tmpdir(), excelResult.filename);
        writeFileSync(tempFilePath, excelResult.buffer);

        try {
          // Загружаем файл в MAX API
          const uploadedFile = await ctx.api.uploadFile({
            source: tempFilePath,
          });

          // Создаем FileAttachment
          const fileAttachment = new FileAttachment({ token: uploadedFile.token });

          const text = [
            "📊 Excel файл с важными датами готов!",
            "",
            `**Всего задач:** ${excelResult.summary.split("\n").length}`,
            "",
            "Файл содержит:",
            "• Дату и время дедлайна",
            "• Название задачи",
            "• Описание",
            "• Ответственного",
            "• Создателя",
            "• Приоритет",
            "• Статус",
          ].join("\n");

          // Отправляем файл пользователю
          const senderUserId = toInt(ctx.user?.user_id);
          if (senderUserId) {
            await ctx.api.sendMessageToUser(senderUserId, text, {
              attachments: [fileAttachment.toJson()],
              format: "markdown",
            });
            
            logger.success("Excel файл экспортирован и отправлен", { userId: senderUserId });
          } else {
            await ctx.answerOnCallback({
              message: {
                text: text + "\n\nФайл отправлен в личные сообщения.",
                format: "markdown",
                attachments: [keyboardService.getBackMenu()],
              },
            });
          }
        } catch (error) {
          logger.error("Ошибка экспорта календаря в Excel", {
            userId,
            location: "action:calendar_export_excel",
            error,
          });
          
          await ctx.answerOnCallback({
            message: {
              text: "Произошла ошибка при экспорте в Excel. Попробуйте позже.",
              attachments: [keyboardService.getBackMenu()],
            },
          });
        } finally {
          // Удаляем временный файл
          try {
            unlinkSync(tempFilePath);
          } catch (cleanupError) {
            logger.warn("Не удалось удалить временный файл", {
              filePath: tempFilePath,
              location: "action:calendar_export_excel",
              error: cleanupError,
            });
          }
        }
      } catch (error) {
        logger.error("Ошибка при генерации Excel файла", {
          userId,
          location: "action:calendar_export_excel",
          error,
        });
        await ctx.answerOnCallback({
          message: {
            text: "Произошла ошибка при генерации Excel файла. Попробуйте позже.",
            attachments: [keyboardService.getBackMenu()],
          },
        });
      }
    });

    // Поиск
    this.bot.action("action:search", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const chatId = await userChatService.getSelectedChat(userId);
      if (!chatId) {
        await ctx.answerOnCallback({
          message: {
            text: [
              "🔍 Поиск",
              "",
              "❌ Активный чат не выбран.",
              "",
              "Для поиска нужно выбрать активный чат.",
              "Используйте кнопку ниже:",
            ].join("\n"),
            attachments: [keyboardService.getChatsMenu()],
          },
        });
        return;
      }

      await ctx.answerOnCallback({
        message: {
          text: [
            "🔍 Поиск по материалам и сообщениям",
            "",
            "Используйте команду /search с запросом:",
            "",
            "Примеры:",
            "• /search презентация",
            "• /search дедлайн",
            "• /search экзамен",
            "",
            "Поиск найдет:",
            "• Материалы (ссылки, документы)",
            "• Сообщения из истории чата",
          ].join("\n"),
          attachments: [keyboardService.getBackMenu()],
        },
      });
    });

    // Настройки
    this.bot.action("action:settings", async (ctx) => {
      const text = "⚙️ Настройки:";
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getSettingsMenu()] },
      });
    });

    this.bot.action("action:settings_reminders", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const preference = await preferenceService.getOrCreate(ensureIdString(userId));
      
      await ctx.answerOnCallback({
        message: {
          text: [
            "⏰ Настройки напоминаний",
            "",
            "Текущие настройки:",
            `• Время напоминания: за ${preference.reminderOffsetMinutes ?? 120} минут до дедлайна`,
            "",
            "Напоминания отправляются автоматически:",
            "• О дедлайнах и задачах",
            "• О важных сообщениях в чате",
            "",
            "Настройки можно изменить через переменные окружения или в будущих версиях через интерфейс.",
          ].join("\n"),
          attachments: [keyboardService.getBackMenu()],
        },
      });
    });

    this.bot.action("action:settings_digest", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      const preference = await preferenceService.getOrCreate(ensureIdString(userId));
      
      await ctx.answerOnCallback({
        message: {
          text: [
            "📅 Настройки дайджеста",
            "",
            "Текущие настройки:",
            preference.digestScheduleCron
              ? `• Расписание: ${preference.digestScheduleCron}`
              : "• Автоматические дайджесты: отключены",
            "",
            "Доступные команды:",
            "• /digest — дайджест за сегодня",
            "• /digest <дата> — дайджест за конкретную дату",
            "• /digest <дата1>:<дата2> — дайджест за период",
            "",
            "Автоматические дайджесты можно настроить через переменные окружения.",
          ].join("\n"),
          attachments: [keyboardService.getBackMenu()],
        },
      });
    });
  }
}

