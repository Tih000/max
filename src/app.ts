import type { Context } from "@maxhub/max-bot-api";
import { Bot, FileAttachment, ImageAttachment } from "@maxhub/max-bot-api";
import type { Message } from "@maxhub/max-bot-api/dist/core/network/api";
import type { AttachmentRequest } from "@maxhub/max-bot-api/dist/core/network/api/types/attachment-request";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
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
import { toInt, toBigInt } from "./utils/number";
import { formatBulletList, formatMaterials, sanitizeText } from "./utils/text";

type CommandContext = Context & { message: Message };

export class App {
  private readonly bot = new Bot(appConfig.MAX_BOT_TOKEN);
  private welcomeImageToken: string | null = null;

  async init() {
    await connectDatabase();
    await reminderService.init(this.handleReminder);
    await scheduledDigestService.init(this.bot.api);
    assistantService.setBotApi(this.bot.api); 
    digestService.setBotApi(this.bot.api); 
    
    await this.preloadWelcomeImage();
    
    this.registerHandlers();
  }


  private async preloadWelcomeImage() {
    try {
      const possiblePaths = [
        join(process.cwd(), "src", "start_photo.png"), 
        join(process.cwd(), "assets", "start_photo.png"), 
        join(__dirname, "..", "assets", "start_photo.png"),
        join(process.cwd(), "start_photo.png"),
      ];

      let imagePath: string | null = null;
      for (const path of possiblePaths) {
        if (existsSync(path)) {
          imagePath = path;
          break;
        }
      }

      if (!imagePath) {
        logger.debug("Изображение приветствия не найдено, работаем без него", {
          location: "preloadWelcomeImage",
          searchedPaths: possiblePaths,
        });
        return;
      }

      const image = await this.bot.api.uploadImage({
        source: readFileSync(imagePath),
      });
      const imageJson = image.toJson();
      if (imageJson.type === "image" && "payload" in imageJson && imageJson.payload) {
        const payload = imageJson.payload as { photos?: Record<string, { token: string }> };
        if (payload.photos) {
          const firstPhoto = Object.values(payload.photos)[0];
          if (firstPhoto?.token) {
            this.welcomeImageToken = firstPhoto.token;
            logger.system("Изображение приветствия предзагружено", {
              location: "preloadWelcomeImage",
              path: imagePath,
            });
          }
        }
      }
    } catch (error) {
      logger.warn("Не удалось предзагрузить изображение приветствия", {
        location: "preloadWelcomeImage",
        error,
      });
    }
  }

  async start() {
    try {
      logger.system("Запуск бота...");
      
      let botInfoRetries = 0;
      const maxBotInfoRetries = 3;
      while (botInfoRetries < maxBotInfoRetries) {
        try {
          this.bot.botInfo ??= await this.bot.api.getMyInfo();
          logger.system(`Бот запущен: @${this.bot.botInfo?.username ?? "unknown"}`);
          break; 
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
          
          logger.error("Не удалось получить информацию о боте", {
            location: "start.getBotInfo",
            error,
          });
          throw error;
        }
      }
      
      this.bot.start().catch((error) => {
        logger.error("Ошибка в цикле polling", {
          location: "start.polling",
          error,
        });
      });
      logger.system("Бот запущен и готов к работе");
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
      
      const userName = ctx.user?.name ?? "друг";
      
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
      
      const attachments: AttachmentRequest[] = [];
      
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
    this.bot.command(/^digest(\s|$)/, async (ctx) => this.handleDigestCommand(ctx as CommandContext));
    this.bot.command("deadlines", async (ctx) => this.handleDeadlinesCommand(ctx as CommandContext));
    this.bot.command("calendar", async (ctx) => this.handleCalendarCommand(ctx as CommandContext));
    this.bot.command(/^search(\s|$)/, async (ctx) => this.handleSearchCommand(ctx as CommandContext));
    this.bot.command("materials", async (ctx) => this.handleMaterialsCommand(ctx as CommandContext));
    this.bot.command("tasks", async (ctx) => this.handleTasksCommand(ctx as CommandContext));
    this.bot.command("chats", async (ctx) => this.handleChatsCommand(ctx as CommandContext));
    this.bot.command("select_chat", async (ctx) => this.handleSelectChatCommand(ctx as CommandContext));
    this.bot.command("sync_chats", async (ctx) => this.handleSyncChatsCommand(ctx as CommandContext));

    this.registerButtonHandlers();

    this.bot.hears(/^(Начать|начать|START|start)$/i, async (ctx) => {
      const userId = ctx.user ? toInt((ctx.user as { user_id?: number }).user_id) : null;
      if (!userId) return;
      
      logger.debug("Получен текст 'Начать'", {
        userId,
        messageText: ctx.message?.body.text,
        location: "hears.Начать",
      });
      
      await this.handleStartCommand(ctx as CommandContext);
    });

    this.bot.on("message_created", async (ctx) => {
      if (!ctx.message) return;
      await this.handleIncomingMessage(ctx);
    });
  }


  private async handleStartCommand(ctx: CommandContext) {
    const userId = ctx.user ? toInt((ctx.user as { user_id?: number }).user_id) : null;
    
    if (!userId) {
      await ctx.reply("Ошибка: не удалось определить пользователя");
      return;
    }

    await preferenceService.getOrCreate(userId);

    const userName = ctx.user && typeof ctx.user === 'object' && 'name' in ctx.user 
      ? (ctx.user as { name?: string }).name ?? "друг"
      : "друг";
    
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
    
    const attachments: AttachmentRequest[] = [];
    
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
    
    attachments.push(keyboardService.getMainMenu(activeChat?.title ?? null));
    
    await ctx.reply(welcomeText, { attachments });
    logger.userAction(userId, "Команда /start выполнена", { userName });
  }


  private isBotMentioned(message: Message, botUserId?: number): boolean {
    if (!botUserId) {
      return false;
    }

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
    
    try {
      await messageService.upsertFromMaxMessage(message);
    } catch (error) {
        logger.error("Не удалось сохранить сообщение", {
          location: "handleIncomingMessage.saveMessage",
          userId: toInt(message.sender?.user_id),
          chatId: toBigInt(message.recipient.chat_id),
          error,
        });
    }

    const chatType = message.recipient.chat_type;
    const isPersonal = chatType === "dialog";
    if (!isPersonal) {
      const userId = toInt(message.sender?.user_id);
      const chatId = toBigInt(message.recipient.chat_id);
      if (userId && chatId) {
        try {
          const chatTitle = ctx.chat?.title ?? undefined;
          await userChatService.addChat(userId, Number(chatId), chatTitle);
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

    if (isCommand) {
      return;
    }

    if (isPersonal) {
      const userId = toInt(message.sender?.user_id);
      if (!userId) {
        logger.warn("Не удалось определить пользователя", {
          location: "handleIncomingMessage.personalChat",
        });
        await ctx.reply("Не удалось определить пользователя. Попробуйте позже.");
        return;
      }

      const userIdNumber = toInt(userId);
      if (!userIdNumber) return;
      const existingPreference = await prisma.userPreference.findUnique({
        where: { userId: userIdNumber },
      });
      
      if (!existingPreference) {
        await preferenceService.getOrCreate(userId);
        
        const userName = message.sender?.name ?? "друг";
        
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
        
        const attachments: AttachmentRequest[] = [];
        
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

      const selectedChatId = await userChatService.getSelectedChat(userId);
      const chatId = selectedChatId;

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

      logger.userAction(userId, "Задан вопрос ассистенту", { chatId: Number(chatId), question: text.substring(0, 50) });
      const answer = await assistantService.answerPersonalQuestion(userId, chatId ? Number(chatId) : null, text, this.bot.api);
      await ctx.reply(answer.body);
      logger.success("Ответ ассистента отправлен", { userId, chatId });
      return;
    }

    const botInfo = this.bot.botInfo;
    const botUserId = botInfo ? toInt((botInfo as { user_id: number }).user_id) : undefined;
    const isMentioned = this.isBotMentioned(message, botUserId);

    if (!isMentioned) {
      try {
        await taskService.processIncomingMessage(message);
        
        const importance = await importantMessageService.checkIfImportant(message);
        if (importance.isImportant) {
          try {
            const chatId = toBigInt(message.recipient.chat_id);
            if (chatId) {
              const chatIdNum = Number(chatId);
              const members = await this.bot.api.getChatMembers(chatIdNum);
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
              chatId: toBigInt(message.recipient.chat_id),
              error,
            });
          }
        }
      } catch (error) {
        logger.error("Не удалось обработать задачи из сообщения", {
          location: "handleIncomingMessage.processTasks",
          userId: toInt(message.sender?.user_id),
          chatId: toBigInt(message.recipient.chat_id),
          error,
        });
      }
      return;
    }

    try {
      const createdTasks = await taskService.processIncomingMessage(message);
      if (createdTasks.length > 0) {
        const response = [
          "Нашёл потенциальные задачи:",
          formatBulletList(
            createdTasks.map((task: Awaited<ReturnType<typeof taskService.processIncomingMessage>>[number]) => {
              const due = task.dueDate ? `дедлайн ${formatDate(task.dueDate)}` : "без срока";
              const assignee = task.assigneeName ? `ответственный: ${task.assigneeName}` : "ответственный не назначен";
              return `${task.title} — ${due}, ${assignee}`;
            }),
          ),
          "Я напомню об этих задачах в личке.",
        ].join("\n");

        await ctx.reply(response);
      } else {
        await ctx.reply("Привет! Я обработал сообщение. Используйте команды для работы со мной: /help");
      }

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


  private async getChatIdForCommand(ctx: CommandContext): Promise<bigint | null> {
    const userId = toInt(ctx.user?.user_id);
    const isPersonal = ctx.message.recipient.chat_type === "dialog";
    
    const contextChatId = toBigInt(ctx.chatId);
    if (contextChatId && !isPersonal) {
      if (userId) {
        try {
          const chatTitle = ctx.chat?.title ?? undefined;
          await userChatService.addChat(userId, contextChatId.toString(), chatTitle);
          await userChatService.selectChat(userId, contextChatId.toString());
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

    if (!userId) {
      return null;
    }

    const selectedChatId = await userChatService.getSelectedChat(userId);
    return selectedChatId;
  }

  private async getActiveChatInfo(userId: number): Promise<{ id: number; title: string | null } | null> {
    const selectedChatId = await userChatService.getSelectedChat(userId);
    if (!selectedChatId) {
      return null;
    }

    const userChats = await userChatService.getUserChats(userId);
    if (!userChats || userChats.length === 0) {
      return null;
    }
    const selectedChat = userChats.find((c) => {
      const cId = toBigInt(c.chatId);
      return cId === selectedChatId;
    });
    
    if (!selectedChatId) {
      return null;
    }
    const id = Number(selectedChatId);
    return selectedChat
      ? { id, title: selectedChat.chatTitle }
      : { id, title: null };
  }

  private async handleDigestCommand(ctx: CommandContext) {
    try {
      const userId = toInt(ctx.user?.user_id);
      logger.command(userId ?? undefined, "digest", ctx.chatId);
      
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
      if (ctx.update?.update_type === "message_callback") {
        await ctx.answerOnCallback({
          message: { text, attachments: [keyboardService.getBackMenu()] },
        });
      } else {
        await ctx.reply(text);
      }
      return;
    }

    type TaskWithReminders = Awaited<ReturnType<typeof taskService.getUpcomingTasks>>[number];
    const summary = formatBulletList(
      tasks.map((task: TaskWithReminders) => {
        const parts = [task.title];
        if (task.dueDate) parts.push(`дедлайн ${formatDate(task.dueDate)}`);
        if (task.assigneeName) parts.push(`ответственный: ${task.assigneeName}`);
        return parts.join(" — ");
      }),
    );

    const text = `📌 Дедлайны на ближайшую неделю:\n\n${summary}`;

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
      const userTasks = await taskService.getPersonalTasks(userId, addDays(new Date(), 60));
      
      if (userTasks.length === 0) {
        await ctx.reply(
          "📅 У вас пока нет задач с дедлайнами.\n\nЗадачи будут автоматически добавлены в календарь, когда появятся дедлайны в чатах.",
          { attachments: [keyboardService.getBackMenu()] }
        );
        return;
      }

      const tasksByDate = new Map<string, typeof userTasks>();
      type TaskWithReminders = Awaited<ReturnType<typeof taskService.getPersonalTasks>>[number];
      userTasks.forEach((task: TaskWithReminders) => {
        if (task.dueDate) {
          const dateStr = formatDate(task.dueDate, "Europe/Moscow");
          const dateKey = dateStr.split(" ")[0] ?? dateStr;
          if (!tasksByDate.has(dateKey)) {
            tasksByDate.set(dateKey, []);
          }
          tasksByDate.get(dateKey)!.push(task);
        }
      });

      const calendarText: string[] = [];
      calendarText.push("📅 **Ваш календарь дедлайнов:**\n");
      
      const sortedDates = Array.from(tasksByDate.keys()).sort();
      
      sortedDates.forEach((dateKey) => {
        const tasks = tasksByDate.get(dateKey)!;
        calendarText.push(`\n**${dateKey}:**`);
        type TaskWithReminders = Awaited<ReturnType<typeof taskService.getPersonalTasks>>[number];
        tasks.forEach((task: TaskWithReminders) => {
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
          if (m.link) {
            let linkUrl = m.link.trim();
            if (!linkUrl.startsWith("http://") && !linkUrl.startsWith("https://")) {
              linkUrl = `https://${linkUrl}`;
            }
            results.push(`${index + 1}. [**${title}**](${linkUrl})`);
          } else {
            results.push(`${index + 1}. **${title}**`);
          }
          
          if (m.description) {
            const desc = m.description.length > 100 ? `${m.description.substring(0, 100)}...` : m.description;
            results.push(`   ${desc}`);
          }
        });
        results.push("");
      }

      if (messages.length > 0) {
        results.push(`💬 Сообщения (${messages.length}):`);
        messages.forEach((m: { text: string | null; senderName: string | null; timestamp: Date }, index: number) => {
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

    const materials = await searchService.getAllMaterials(chatId ? chatId.toString() : "", 30);
    if (materials.length === 0) {
      const text = "В чате пока нет материалов.";
      if (ctx.update?.update_type === "message_callback") {
        await ctx.answerOnCallback({
          message: { text, attachments: [keyboardService.getBackMenu()] },
        });
      } else {
        await ctx.reply(text);
      }
      return;
    }

    const formattedMaterials = formatMaterials(materials);

    const text = [
      `📎 Материалы из чата (${materials.length}):`,
      "",
      formattedMaterials,
    ].join("\n");

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
          tasks.map((task: Awaited<ReturnType<typeof taskService.getAllTasks>>[number]) => {
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
    if (!userChats || userChats.length === 0) {
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
    const selectedChatId = await userChatService.getSelectedChat(userId);

    const chatList = userChats.map((chat: { chatId: bigint | number | string; chatTitle: string | null }, index: number) => {
      const chatIdNum = toBigInt(chat.chatId);
      const isSelected = chatIdNum === selectedChatId;
      const marker = isSelected ? "✅" : `${index + 1}.`;
      const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
      return `${marker} ${chat.chatTitle ?? `Чат ${chatIdDisplay}`}${isSelected ? " (выбран)" : ""}`;
    });

    const chats = userChats.map((chat: { chatId: bigint | number | string; chatTitle: string | null }) => {
      const chatIdNum = toBigInt(chat.chatId);
      const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
      return {
        id: chatIdDisplay,
        title: chat.chatTitle ?? `Чат ${chatIdDisplay}`,
      };
    });

    const selectedChatIdNum = selectedChatId ? Number(selectedChatId) : undefined;

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
      await this.handleChatsCommand(ctx);
      await ctx.reply(
        "\nИспользуйте: /select_chat <номер> или /select_chat <chat_id> для выбора чата.",
      );
      return;
    }

    const chatIndex = Number.parseInt(chatNumberOrId, 10);
    const userChats = await userChatService.getUserChats(userId);
    if (!userChats || userChats.length === 0) {
      await ctx.reply("Чат не найден. Используйте /chats для просмотра списка чатов.");
      return;
    }

    let selectedChat;
    if (!Number.isNaN(chatIndex) && chatIndex > 0 && chatIndex <= userChats.length) {
      selectedChat = userChats[chatIndex - 1];
    } else {
      const chatId = toBigInt(chatNumberOrId);
      if (!chatId) {
        await ctx.reply("Не удалось определить ID чата.");
        return;
      }
      selectedChat = userChats.find((c: { chatId: bigint | number | string }) => {
        const cId = toBigInt(c.chatId);
        return cId === chatId;
      });
    }

    if (!selectedChat) {
      await ctx.reply("Чат не найден. Используйте /chats для просмотра списка чатов.");
      return;
    }

    try {
      const selectedChatIdBigInt = toBigInt(selectedChat.chatId);
      if (!selectedChatIdBigInt) {
        await ctx.reply("Ошибка: не удалось определить ID чата.");
        return;
      }
      await userChatService.selectChat(userId, Number(selectedChatIdBigInt));
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

    const chrono = require("chrono-node");
    const now = new Date();
    
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

    const parsed = chrono.parseDate(arg, now);
    if (parsed) {
      return { from: startOfDay(parsed), to: endOfDay(parsed) };
    }

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
        const numericChatId = toBigInt(task.chatId);
        if (!numericChatId) {
          logger.error("Не удалось преобразовать chatId в BigInt для напоминания", {
            chatId: task.chatId,
            location: "handleReminder",
            error: new Error("Invalid chatId"),
          });
          return;
        }
        const chatIdNum = Number(numericChatId);
        await this.bot.api.sendMessageToChat(chatIdNum, messageLines.join("\n"));
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


  private registerButtonHandlers() {

    this.bot.action("start", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      await preferenceService.getOrCreate(userId);
      
      const userName = ctx.user?.name ?? "друг";
      
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
      
      const attachments: AttachmentRequest[] = [];
      
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
      
      attachments.push(keyboardService.getMainMenu(activeChat?.title ?? null));
      
      await ctx.answerOnCallback({
        message: { text: welcomeText, attachments },
      });
      
      logger.userAction(userId, "Кнопка 'Начать' нажата", { userName });
    });

    this.bot.action("action:start", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      await preferenceService.getOrCreate(userId);
      
      const userName = ctx.user?.name ?? "друг";
      
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
      
      const attachments: AttachmentRequest[] = [];
      
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
      
      attachments.push(keyboardService.getMainMenu(activeChat?.title ?? null));
      
      await ctx.answerOnCallback({
        message: { text: welcomeText, attachments },
      });
      
      logger.userAction(userId, "Кнопка 'Начать' нажата (action:start)", { userName });
    });

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

      try {
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

        const userChats = await userChatService.getUserChats(userId);
        if (!userChats || userChats.length === 0) {
          await ctx.answerOnCallback({
            message: {
              text: "У вас пока нет чатов. Чат будет добавлен автоматически, когда вы отправите сообщение в групповой чат.",
              attachments: [keyboardService.getBackMenu()],
            },
          });
          return;
        }

        const selectedChatId = await userChatService.getSelectedChat(userId);
        const chatList = userChats.map((chat, index: number) => {
          const chatIdNum = toBigInt(chat.chatId);
          const isSelected = chatIdNum === selectedChatId;
          const marker = isSelected ? "✅" : `${index + 1}.`;
          const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
          return `${marker} ${chat.chatTitle ?? `Чат ${chatIdDisplay}`}${isSelected ? " (выбран)" : ""}`;
        });

    const chats = userChats.map((chat) => {
      const chatIdNum = toBigInt(chat.chatId);
      const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
      return {
        id: chatIdDisplay,
        title: chat.chatTitle ?? `Чат ${chatIdDisplay}`,
      };
    });

        const selectedChatIdNum = selectedChatId ?? undefined;

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
          message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum ? Number(selectedChatIdNum) : undefined)] },
        });
      } catch (error) {
        logger.error("Ошибка синхронизации чатов", {
          userId,
          location: "action:chats_list",
          error,
        });
        
        const userChats = await userChatService.getUserChats(userId);
        if (!userChats || userChats.length === 0) {
          await ctx.answerOnCallback({
            message: {
              text: "Ошибка синхронизации чатов. Попробуйте позже.",
              attachments: [keyboardService.getBackMenu()],
            },
          });
          return;
        }

        const selectedChatId = await userChatService.getSelectedChat(userId);
        const chatList = userChats.map((chat, index: number) => {
          const chatIdNum = toBigInt(chat.chatId);
          const isSelected = chatIdNum === selectedChatId;
          const marker = isSelected ? "✅" : `${index + 1}.`;
          const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
          return `${marker} ${chat.chatTitle ?? `Чат ${chatIdDisplay}`}${isSelected ? " (выбран)" : ""}`;
        });

    const chats = userChats.map((chat) => {
      const chatIdNum = toBigInt(chat.chatId);
      const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
      return {
        id: chatIdDisplay,
        title: chat.chatTitle ?? `Чат ${chatIdDisplay}`,
      };
    });

        const selectedChatIdNum = selectedChatId ?? undefined;

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
          message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum ? Number(selectedChatIdNum) : undefined)] },
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
        
        const userChats = await userChatService.getUserChats(userId);
        const selectedChatId = await userChatService.getSelectedChat(userId);
        
        if (userChats.length > 0) {
          const chatList = userChats.map((chat: { chatId: bigint | number | string; chatTitle: string | null }, index: number) => {
            const chatIdNum = toBigInt(chat.chatId);
            const isSelected = chatIdNum === selectedChatId;
            const marker = isSelected ? "✅" : `${index + 1}.`;
            const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
            return `${marker} ${chat.chatTitle ?? `Чат ${chatIdDisplay}`}${isSelected ? " (выбран)" : ""}`;
          });

          const chats = userChats.map((chat: { chatId: bigint | number | string; chatTitle: string | null }) => {
            const chatIdNum = toBigInt(chat.chatId);
            const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
            return {
              id: chatIdDisplay,
              title: chat.chatTitle ?? `Чат ${chatIdDisplay}`,
            };
          });

          const selectedChatIdNum = selectedChatId ? Number(selectedChatId) : undefined;

          const text = [
            `✅ Синхронизировано ${count} чатов.`,
            "",
            "📋 Ваши чаты:",
            "",
            formatBulletList(chatList),
            "",
            "Выберите чат кнопкой ниже:",
          ].join("\n");

          await ctx.answerOnCallback({
            message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum ? Number(selectedChatIdNum) : undefined)] },
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
        await userChatService.selectChat(userId, chatIdStr);
        const userChats = await userChatService.getUserChats(userId);
        if (!userChats) return;
        const chatIdNum = toBigInt(chatIdStr);
        if (!chatIdNum) return;
        const selectedChat = userChats.find((c: { chatId: bigint | number | string }) => {
          const cId = toBigInt(c.chatId);
          return cId === chatIdNum;
        });
        const selectedChatTitle = selectedChat?.chatTitle ?? `Чат ${Number(chatIdNum)}`;
        
        const chats = userChats.map((chat: { chatId: bigint | number | string; chatTitle: string | null }) => {
          const cId = toBigInt(chat.chatId);
          return {
            id: cId ? Number(cId) : 0,
            title: chat.chatTitle ?? `Чат ${cId ? Number(cId) : 0}`,
          };
        });

        const chatList = userChats.map((chat: { chatId: bigint | number | string; chatTitle: string | null }, index: number) => {
          const cId = toBigInt(chat.chatId);
          const isSelected = cId === chatIdNum;
          const marker = isSelected ? "✅" : `${index + 1}.`;
          const chatIdDisplay = cId ? Number(cId) : 0;
          return `${marker} ${chat.chatTitle ?? `Чат ${chatIdDisplay}`}${isSelected ? " (выбран)" : ""}`;
        });

        const selectedChatIdNum = toBigInt(chatIdStr);

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
          message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum ? Number(selectedChatIdNum) : undefined)] },
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
      if (!userChats || userChats.length === 0) {
        await ctx.answerOnCallback({
          notification: "У вас нет чатов. Используйте /sync_chats для синхронизации.",
        });
        return;
      }

      const selectedChatId = await userChatService.getSelectedChat(userId);
      const chats = userChats.map((chat: { chatId: bigint | number | string; chatTitle: string | null }) => {
        const chatIdNum = toBigInt(chat.chatId);
        const chatIdDisplay = chatIdNum ? Number(chatIdNum) : 0;
        return {
          id: chatIdDisplay,
          title: chat.chatTitle ?? `Чат ${chatIdDisplay}`,
        };
      });

      const selectedChatIdNum = selectedChatId ? Number(selectedChatId) : undefined;

      const text = "Выберите чат:";
      await ctx.answerOnCallback({
        message: { text, attachments: [keyboardService.getChatSelectionMenu(chats, selectedChatIdNum)] },
      });
    });

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

      const tasks = await taskService.getAllTasks(chatId, 30);
      if (tasks.length === 0) {
        await ctx.answerOnCallback({
          message: { text: "В чате пока нет задач.", attachments: [keyboardService.getBackMenu()] },
        });
        return;
      }

      type TaskWithReminders = Awaited<ReturnType<typeof taskService.getAllTasks>>[number];
      const summary = formatBulletList(
        tasks.map((task: TaskWithReminders) => {
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

      const tasks = await taskService.getUpcomingTasks(chatId, addDays(new Date(), 7));
      if (tasks.length === 0) {
        await ctx.answerOnCallback({ notification: "На неделю задач не найдено" });
        return;
      }

      type TaskWithReminders = Awaited<ReturnType<typeof taskService.getUpcomingTasks>>[number];
      const summary = formatBulletList(
        tasks.map((task: TaskWithReminders) => {
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

      const tomorrow = addDays(new Date(), 1);
      const tasks = await taskService.getUpcomingTasks(chatId, endOfDay(tomorrow));
      if (tasks.length === 0) {
        await ctx.answerOnCallback({ notification: "На завтра задач не найдено" });
        return;
      }

      type TaskWithReminders = Awaited<ReturnType<typeof taskService.getUpcomingTasks>>[number];
      const summary = formatBulletList(
        tasks.map((task: TaskWithReminders) => {
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

      const tasks = await taskService.getUpcomingTasks(chatId, addDays(new Date(), 7));
      if (tasks.length === 0) {
        await ctx.answerOnCallback({
          message: { text: "На ближайшую неделю дедлайнов не найдено.", attachments: [keyboardService.getBackMenu()] },
        });
        return;
      }

      type TaskWithReminders = Awaited<ReturnType<typeof taskService.getUpcomingTasks>>[number];
      const summary = formatBulletList(
        tasks.map((task: TaskWithReminders) => {
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

      const materials = await searchService.getAllMaterials(chatId.toString(), 30);
      if (materials.length === 0) {
        await ctx.answerOnCallback({
          message: { text: "В чате пока нет материалов.", attachments: [keyboardService.getBackMenu()] },
        });
        return;
      }

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

      const today = new Date();
      const fromDate = startOfDay(today);
      const toDate = endOfDay(today);
      
      const userChats = await userChatService.getUserChats(userId);
      if (!userChats) return;
      const chatIdBigInt = toBigInt(chatId);
      if (!chatIdBigInt) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить ID чата." });
        return;
      }
      const selectedChat = userChats.find((c) => {
        const cId = toBigInt(c.chatId);
        return cId === chatIdBigInt;
      });
      const chatIdDisplay = Number(chatIdBigInt);
      const chatTitle = selectedChat?.chatTitle ?? `Чат ${chatIdDisplay}`;
      
      const digest = await digestService.generateDigest(chatIdBigInt, chatTitle, { from: fromDate, to: toDate }, {}, this.bot.api);
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

      const now = new Date();
      const fromDate = startOfWeek(now);
      const toDate = endOfWeek(now);
      
      const userChats = await userChatService.getUserChats(userId);
      if (!userChats) return;
      const chatIdBigInt = toBigInt(chatId);
      if (!chatIdBigInt) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить ID чата." });
        return;
      }
      const selectedChat = userChats.find((c) => {
        const cId = toBigInt(c.chatId);
        return cId === chatIdBigInt;
      });
      const chatIdDisplay = Number(chatIdBigInt);
      const chatTitle = selectedChat?.chatTitle ?? `Чат ${chatIdDisplay}`;
      
      const digest = await digestService.generateDigest(chatIdBigInt, chatTitle, { from: fromDate, to: toDate }, {}, this.bot.api);
      if (!digest) {
        await ctx.answerOnCallback({ notification: "Дайджест за неделю пуст" });
        return;
      }

      await ctx.answerOnCallback({
        message: { text: digest, attachments: [keyboardService.getBackMenu()] },
      });
    });

    this.bot.action("action:calendar", async (ctx) => {
      const userId = toInt(ctx.user?.user_id);
      if (!userId) {
        await ctx.answerOnCallback({ notification: "Ошибка: не удалось определить пользователя" });
        return;
      }

      try {
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

        const tasksByDate = new Map<string, typeof userTasks>();
        type TaskWithReminders = Awaited<ReturnType<typeof taskService.getPersonalTasks>>[number];
        userTasks.forEach((task: TaskWithReminders) => {
          if (task.dueDate) {
            const dateStr = formatDate(task.dueDate, "Europe/Moscow");
            const dateKey = dateStr.split(" ")[0] ?? dateStr; 
            if (!tasksByDate.has(dateKey)) {
              tasksByDate.set(dateKey, []);
            }
            tasksByDate.get(dateKey)!.push(task);
          }
        });

        const calendarText: string[] = [];
        calendarText.push("📅 **Ваш календарь дедлайнов:**\n");
        
        const sortedDates = Array.from(tasksByDate.keys()).sort();
        
        sortedDates.forEach((dateKey) => {
          const tasks = tasksByDate.get(dateKey)!;
          calendarText.push(`\n**${dateKey}:**`);
          type TaskWithReminders = Awaited<ReturnType<typeof taskService.getPersonalTasks>>[number];
          tasks.forEach((task: TaskWithReminders) => {
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

        const tempFilePath = join(tmpdir(), excelResult.filename);
        writeFileSync(tempFilePath, excelResult.buffer);

        try {
          const uploadedFile = await ctx.api.uploadFile({
            source: tempFilePath,
          });

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

      const preference = await preferenceService.getOrCreate(toInt(userId) ?? 0);
      
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

      const preference = await preferenceService.getOrCreate(toInt(userId) ?? 0);
      
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

