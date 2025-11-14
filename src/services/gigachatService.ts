import axios, { AxiosInstance } from "axios";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "node:fs";
import { Agent as HttpsAgent } from "node:https";
import path from "node:path";
import * as chrono from "chrono-node";
import { appConfig, isGigaChatEnabled } from "../config";
import { logger } from "../logger";
import { DigestOptions, ParsedTask } from "../types";
import { formatDate, formatRange } from "../utils/date";
import { formatBulletList, truncate } from "../utils/text";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CompletionResponse = {
  result: string;
  payload?: unknown;
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

export class GigaChatService {
  private readonly authClient: AxiosInstance;
  private readonly apiClient: AxiosInstance;
  private tokenCache: TokenCache | null = null;
  public readonly enabled: boolean;

  constructor() {
    this.enabled = isGigaChatEnabled;
    const httpsAgent = this.createHttpsAgent();
    
    this.authClient = axios.create({
      baseURL: appConfig.GIGACHAT_AUTH_URL,
      httpsAgent,
    });

    this.apiClient = axios.create({
      baseURL: appConfig.GIGACHAT_BASE_URL,
      httpsAgent,
    });
  }

  private createHttpsAgent(): HttpsAgent {
    const certPathStr = appConfig.GIGACHAT_CA_CERT_PATH ?? "";
    const certPaths = certPathStr.split(";").map((p: string) => p.trim()).filter(Boolean);
    
    if (certPaths.length === 0) {
      logger.warn("Сертификаты CA для GigaChat не указаны, используется системный сертификат", {
        location: "createHttpsAgent",
      });
      return new HttpsAgent();
    }

    const caBundle: Buffer[] = [];
    for (const certPath of certPaths) {
      const resolvedPath = path.isAbsolute(certPath) ? certPath : path.resolve(process.cwd(), certPath);
      if (!existsSync(resolvedPath)) {
        logger.error("Сертификат CA GigaChat не найден", { certPath: resolvedPath, location: "createHttpsAgent" });
        continue;
      }
      try {
        caBundle.push(readFileSync(resolvedPath));
      } catch (error) {
        logger.error("Не удалось прочитать сертификат CA GigaChat", {
          certPath: resolvedPath,
          location: "createHttpsAgent",
          error,
        });
      }
    }

    if (caBundle.length === 0) {
      logger.warn("Не удалось загрузить сертификаты CA для GigaChat, используется системный сертификат", {
        location: "createHttpsAgent",
      });
      return new HttpsAgent();
    }

    return new HttpsAgent({
      ca: caBundle,
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    let credentialsInfo: string = "";
    let requestUrl: string = "";
    
    try {
      let authHeader: string;
      
      if (appConfig.GIGACHAT_AUTHORIZATION_KEY) {
        const authKey = appConfig.GIGACHAT_AUTHORIZATION_KEY.trim();
        
        let base64Key = authKey;
        if (authKey.startsWith("Basic ")) {
          base64Key = authKey.substring(6).trim();
        }
        
        try {
          const decoded = Buffer.from(base64Key, "base64").toString("utf-8");
          credentialsInfo = `Decoded: ${decoded.substring(0, 20)}... (client_id:client_secret format)`;
          
          authHeader = `Basic ${base64Key}`;
        } catch (decodeError) {
          logger.warn("Не удалось декодировать GIGACHAT_AUTHORIZATION_KEY как base64", {
            error: decodeError,
            location: "getAccessToken",
          });
          if (authKey.startsWith("Basic ")) {
            authHeader = authKey;
          } else {
            authHeader = `Basic ${authKey}`;
          }
          credentialsInfo = "Using as-is (cannot decode)";
        }
      } else if (appConfig.GIGACHAT_CLIENT_ID && appConfig.GIGACHAT_CLIENT_SECRET) {
        const credentials = `${appConfig.GIGACHAT_CLIENT_ID}:${appConfig.GIGACHAT_CLIENT_SECRET}`;
        authHeader = `Basic ${Buffer.from(credentials).toString("base64")}`;
        credentialsInfo = `Generated from CLIENT_ID:CLIENT_SECRET`;
      } else {
        throw new Error("GigaChat credentials not configured: either GIGACHAT_AUTHORIZATION_KEY or GIGACHAT_CLIENT_ID/GIGACHAT_CLIENT_SECRET must be provided");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Authorization": authHeader,
        "RqUID": randomUUID(),
      };


      const bodyParams = new URLSearchParams();
      bodyParams.set("scope", appConfig.GIGACHAT_SCOPE);
      const bodyString = bodyParams.toString();

      requestUrl = "";

      logger.debug("GigaChat token request", {
        baseURL: appConfig.GIGACHAT_AUTH_URL,
        url: requestUrl || "(empty - root)",
        fullUrl: `${appConfig.GIGACHAT_AUTH_URL}${requestUrl}`,
        method: "POST",
        headers: { 
          "Content-Type": headers["Content-Type"],
          "Accept": headers["Accept"],
          "Authorization": "Basic ***",
          "RqUID": headers.RqUID,
        },
        body: bodyString,
        scope: appConfig.GIGACHAT_SCOPE,
        credentialsInfo,
        authHeaderLength: authHeader.length,
        location: "getAccessToken",
      });

      const response = await this.authClient.post(requestUrl, bodyString, { headers });

      const token = response.data?.access_token;
      if (!token || typeof token !== "string") {
        logger.error("GigaChat API не вернул токен", {
          response: response.data,
          location: "getAccessToken",
        });
        throw new Error("GigaChat API не вернул токен доступа");
      }

      const expiresAt = response.data?.expires_at;
      const expiresIn = response.data?.expires_in;
      
      let tokenExpiresAt: number;
      if (expiresAt !== undefined && expiresAt !== null) {
        if (typeof expiresAt === "number") {
          tokenExpiresAt = expiresAt > Date.now() ? expiresAt : expiresAt * 1000;
        } else if (typeof expiresAt === "string") {
          tokenExpiresAt = new Date(expiresAt).getTime();
        } else {
          tokenExpiresAt = Date.now() + 30 * 60 * 1000;
        }
      } else if (expiresIn !== undefined && expiresIn !== null) {
        const expiresInSeconds = typeof expiresIn === "number" ? expiresIn : parseInt(String(expiresIn), 10);
        tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
      } else {
        tokenExpiresAt = Date.now() + 30 * 60 * 1000;
      }

      this.tokenCache = {
        token,
        expiresAt: tokenExpiresAt - 60000,
      };

      logger.debug("GigaChat token получен", {
        expiresAt: new Date(this.tokenCache.expiresAt).toISOString(),
        location: "getAccessToken",
      });

      return token;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const response = error.response;
        const status = response?.status;
        const statusText = response?.statusText;
        const responseHeaders = response?.headers;
        const errorData = response?.data;
        
        let errorMessage: string;
        if (typeof errorData === "string") {
          errorMessage = errorData;
        } else if (errorData && typeof errorData === "object") {
          errorMessage = JSON.stringify(errorData);
        } else {
          errorMessage = error.message ?? "Unknown error";
        }
        
        logger.error("Ошибка получения токена GigaChat", {
          status,
          statusText,
          statusCode: status,
          responseHeaders: responseHeaders ? Object.keys(responseHeaders) : undefined,
          errorData: errorMessage,
          requestUrl: `${appConfig.GIGACHAT_AUTH_URL}${requestUrl || ""}`,
          scope: appConfig.GIGACHAT_SCOPE,
          hasAuthKey: Boolean(appConfig.GIGACHAT_AUTHORIZATION_KEY),
          hasClientId: Boolean(appConfig.GIGACHAT_CLIENT_ID),
          hasClientSecret: Boolean(appConfig.GIGACHAT_CLIENT_SECRET),
          credentialsInfo,
          location: "getAccessToken",
        });
        
        if (status === 400) {
          logger.error("Возможные причины ошибки 400:", {
            reasons: [
              "Неправильный формат GIGACHAT_AUTHORIZATION_KEY (должен быть base64 строка client_id:client_secret)",
              "Неправильный scope (должен быть GIGACHAT_API_PERS, GIGACHAT_API_B2B или GIGACHAT_API_CORP)",
              "Истек срок действия credentials",
              "Неправильный формат запроса",
            ],
            currentScope: appConfig.GIGACHAT_SCOPE,
            location: "getAccessToken",
          });
        }
      } else {
        logger.error("Ошибка получения токена GigaChat", {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          location: "getAccessToken",
        });
      }
      throw error;
    }
  }

  private async complete(messages: ChatMessage[], temperature = 0.2): Promise<CompletionResponse> {
    if (!this.enabled) {
      throw new Error("GigaChat integration is not configured");
    }

    const token = await this.getAccessToken();
    const maxRetries = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.apiClient.post(
          "/chat/completions",
          {
            model: appConfig.GIGACHAT_MODEL,
            messages,
            temperature,
            max_tokens: 2000,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
          },
        );

        return {
          result: response.data.choices[0]?.message?.content ?? "",
          payload: response.data,
        };
      } catch (error: unknown) {
        lastError = error;
        if (attempt < maxRetries) {
          const delay = attempt * 1000;
          logger.warn(`Ошибка запроса к GigaChat, попытка ${attempt}/${maxRetries}`, {
            error: error instanceof Error ? error.message : String(error),
            location: "complete",
            attempt,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error("Не удалось выполнить запрос к GigaChat после всех попыток", {
      error: lastError instanceof Error ? lastError.message : String(lastError),
      location: "complete",
    });
    throw lastError;
  }

  async summarizeChat(
    chatTitle: string,
    preparedMessages: string,
    range: { from: Date; to: Date },
    options: DigestOptions = {},
    chatMembers: Array<{ id: string; name: string; username?: string; messageCount?: number }> = [],
    _materials: Array<{ title: string; link?: string | null; description?: string | null }> = [], 
  ): Promise<string> {
    if (!this.enabled) {
      throw new Error("GigaChat integration is not configured");
    }

    const membersInfo = chatMembers.length > 0
      ? [
          "",
          "УЧАСТНИКИ ЧАТА:",
          formatBulletList(
            chatMembers
              .sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))
              .slice(0, 15)
              .map((m) => {
                const parts = [m.name];
                if (m.username) parts.push(`@${m.username}`);
                if (m.messageCount && m.messageCount > 0) parts.push(`(${m.messageCount} сообщ.)`);
                return parts.join(" ");
              }),
          ),
        ].join("\n")
      : "";

    const prompt = [
      `Ты — умный ассистент-аналитик учебного чата «${chatTitle}».`,
      "",
      "ТВОЯ ЗАДАЧА:",
      "Подготовь красивый, структурированный и визуально привлекательный дайджест обсуждений за указанный период.",
      "",
      "СТРУКТУРА ДАЙДЖЕСТА (обязательно используй эмодзи и Markdown форматирование):",
      "",
      "📌 **ОСНОВНЫЕ ТЕМЫ**",
      "Краткое описание ключевых тем обсуждения (3-5 пунктов, каждый с эмодзи)",
      "",
      "📅 **ДЕДЛАЙНЫ И ЗАДАЧИ**",
      "Группируй задачи по датам. Формат:",
      "- `📆 13.11.2025`",
      "  • Название задачи — *ответственный: Имя*",
      "  • Еще задача — *ответственный: Имя*",
      "",
      "Если задач нет, напиши: *Дедлайнов не обнаружено*",
      "",
      "👥 **АКТИВНОСТЬ УЧАСТНИКОВ**",
      "Топ-5 самых активных участников в формате:",
      "• **Имя** — X сообщений",
      "",
      "🎯 **СЛЕДУЮЩИЕ ШАГИ**",
      "3-5 конкретных действий с указанием ответственных и сроков",
      "",
      "ПРАВИЛА ФОРМАТИРОВАНИЯ:",
      "- Используй эмодзи для визуального разделения секций (📌, 📅, 📎, 👥, 🎯)",
      "- Заголовки разделов: **ЖИРНЫЙ ТЕКСТ** с эмодзи",
      "- Даты: `код` формате (например: `13.11.2025`)",
      "- Задачи: маркированные списки с отступом под датами",
      "- Ответственные: *курсив* после названия задачи",
      "- Активность: **жирный** для имен, обычный текст для количества",
      "- Следующие шаги: маркированные списки с эмодзи и выделением",
      "- Используй пустые строки для разделения секций",
      "- Группируй дедлайны по датам для лучшей читаемости",
      "",
      "ПРАВИЛА СОДЕРЖАНИЯ:",
      "- Пиши кратко, но информативно",
      "- Используй активные формулировки",
      "- Указывай конкретные даты и ответственных",
      "- Если информации нет, честно об этом скажи (например: *Материалы не найдены*)",
      "- Анализируй ВСЮ историю сообщений для полного понимания контекста",
      "- Максимум 2500 символов, но будь информативным",
      "",
      "ПРИМЕР ХОРОШЕГО ДАЙДЖЕСТА:",
      "📌 **ОСНОВНЫЕ ТЕМЫ**",
      "",
      "🔧 Разработка новой функциональности",
      "📊 Анализ пользовательских данных",
      "🎨 Обновление дизайна интерфейса",
      "",
      "📅 **ДЕДЛАЙНЫ И ЗАДАЧИ**",
      "",
      "`15.11.2025`",
      "  • Завершить разработку модуля — *ответственный: Иван*",
      "  • Подготовить презентацию — *ответственный: Мария*",
      "",
      "`20.11.2025`",
      "  • Тестирование новой функциональности — *ответственный: Петр*",
      "",
      "ВАЖНО: Сделай дайджест визуально привлекательным и легко читаемым!",
      membersInfo,
    ]
      .filter(Boolean)
      .join("\n");

    const materialsInfo = "";

    const userMessage: ChatMessage = {
      role: "user",
      content: [
        `Период: ${formatRange(range.from, range.to)}`,
        "Чат-лог:",
        preparedMessages,
        materialsInfo,
        options.includeActionItems === false
          ? "Можно опустить блок с действиями."
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };

    const completion = await this.complete([
      { role: "system", content: prompt },
      userMessage,
    ]);

    return truncate(completion.result.trim(), 2500);
  }

  async extractTasks(
    messageText: string,
    context?: string,
    existingTasks?: Array<{ title: string; dueDate?: Date | null }>,
  ): Promise<ParsedTask[]> {
    if (!this.enabled) {
      return [];
    }

    const basePrompt = [
      "Ты — умный помощник для извлечения задач и дедлайнов из сообщений в учебном чате.",
      "",
      "ЗАДАЧА:",
      "Проанализируй текст сообщения и контекст обсуждения, чтобы определить, содержит ли сообщение дедлайн или задачу.",
      "",
      "ПРАВИЛА ИЗВЛЕЧЕНИЯ ДЕДЛАЙНОВ:",
      "1. Дедлайн — это дата/время, к которому нужно выполнить работу или задачу",
      "2. Ищи следующие признаки дедлайна:",
      "   - Явные слова: дедлайн, deadline, до, к, нужно сделать, требуется, необходимо выполнить, сдать, подготовить",
      "   - Даты с контекстом задачи: 'отчет до 15 января', 'проект к 20.01', 'презентация на пятницу'",
      "   - Указания на выполнение работы: 'сделать к', 'готовить к', 'завершить до'",
      "3. Используй контекст обсуждения для понимания, идет ли речь о дедлайне или просто упоминании даты",
      "4. Если в сообщении есть дата И указание на работу/задачу — это дедлайн",
      "",
      "ЧТО НЕ ЯВЛЯЕТСЯ ДЕДЛАЙНОМ (НЕ создавай задачи):",
      "- Просто упоминания дат без контекста задачи: 'встреча 15 января', 'экзамен 20 числа'",
      "- События без указания на выполнение работы: 'конференция 10 марта', 'праздник 8 марта'",
      "- Упоминания дат в прошлом: 'вчера мы обсуждали', 'на прошлой неделе'",
      "",
      "ПРАВИЛА ИЗВЛЕЧЕНИЯ ЗАДАЧ:",
      "1. Задача — это конкретное действие, которое нужно выполнить к определенной дате",
      "2. Ответственный — человек, которому назначена задача (упоминание @username или имя)",
      "3. Если задача уже существует (проверь список существующих задач), не создавай дубликат",
      "4. Используй контекст обсуждения для понимания, о чем идет речь",
      "",
      "ПРИМЕРЫ ДЕДЛАЙНОВ (создавай задачи):",
      "- 'Нужно сделать отчет до 15 января' → задача: 'Сделать отчет', дедлайн: 15 января",
      "- 'Дедлайн по проекту: 20.01.2025' → задача: 'Проект', дедлайн: 20.01.2025",
      "- 'Ивану: подготовь презентацию к пятнице' → задача: 'Подготовить презентацию', дедлайн: пятница, ответственный: Иван",
      "- 'Задача: проверить код, дедлайн: через неделю' → задача: 'Проверить код', дедлайн: через неделю",
      "- 'Сдать домашнее задание до 25 декабря' → задача: 'Сдать домашнее задание', дедлайн: 25 декабря",
      "- 'К 10 января нужно подготовить материалы' → задача: 'Подготовить материалы', дедлайн: 10 января",
      "",
      "ПРИМЕРЫ НЕ ДЕДЛАЙНОВ (НЕ создавай задачи):",
      "- 'Встреча 15 января в 10:00' (это событие, а не дедлайн)",
      "- 'Экзамен будет 20 числа' (это событие, а не дедлайн)",
      "- 'Сегодня хорошая погода' (просто упоминание даты)",
      "- 'Вчера мы обсуждали проект' (просто упоминание даты в прошлом)",
      "",
      "ФОРМАТ ОТВЕТА (строго JSON):",
      `[{ "title": string, "description": string?, "dueDate": string?, "assigneeName": string? }]`,
      "",
      "ВАЖНО:",
      "- Если сообщение содержит дедлайн или задачу с датой — ОБЯЗАТЕЛЬНО создай задачу",
      "- Если сообщение НЕ содержит дедлайна или задачи, верни пустой массив []",
      "- ФОРМАТ ДАТЫ: используй ISO8601 формат: 2025-11-15T23:59:00",
      "- ОТНОСИТЕЛЬНЫЕ ДАТЫ: если указано 'завтра', 'послезавтра', 'через неделю' — ВЫЧИСЛИ конкретную дату в ISO8601 формате",
      "- КРИТИЧЕСКИ ВАЖНО: 'завтра' означает следующий день от текущей даты, НЕ сегодня!",
      "- Примеры правильных дат:",
      "  * 'завтра' → 2025-11-14T23:59:00 (если сегодня 13.11.2025)",
      "  * 'послезавтра' → 2025-11-15T23:59:00",
      "  * 'через неделю' → 2025-11-20T23:59:00",
      "  * 'через 3 дня' → 2025-11-16T23:59:00",
      "- НЕ используй относительные слова ('завтра', 'today', 'tomorrow') в dueDate — только ISO8601 дату!",
      "- Если задача назначена конкретному человеку, обязательно укажи его в assigneeName",
      "- Избегай повторов в описаниях, будь конкретным",
      "- Будь внимательным: если есть дата и указание на работу — это дедлайн",
    ].join("\n");

    const existingTasksInfo = existingTasks && existingTasks.length > 0
      ? [
          "",
          "СУЩЕСТВУЮЩИЕ ЗАДАЧИ (не создавай дубликаты):",
          formatBulletList(
            existingTasks.map((t) => `${t.title}${t.dueDate ? ` (${formatDate(t.dueDate)})` : ""}`),
          ),
        ].join("\n")
      : "";

    const currentDate = new Date();
    const currentDateStr = currentDate.toISOString().split("T")[0]; 
    const currentDateFormatted = `${currentDateStr} (сегодня)`;
    
    const userMessage = [
      `ТЕКУЩАЯ ДАТА: ${currentDateFormatted}`,
      "",
      "ТЕКСТ СООБЩЕНИЯ:",
      messageText,
      context ? `\nКОНТЕКСТ ОБСУЖДЕНИЯ:\n${context}` : "",
      existingTasksInfo,
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: ChatMessage[] = [
      { role: "system", content: basePrompt },
      {
        role: "user",
        content: userMessage,
      },
    ];

    const completion = await this.complete(messages, 0.2);

    if (process.env.LOG_LEVEL === "debug") {
      logger.debug("GigaChat extractTasks response", {
        messageText: messageText.substring(0, 200),
        rawResponse: completion.result.substring(0, 500),
        location: "extractTasks",
      });
    }

    try {
      let result = completion.result.trim();
      
      const jsonMatch = result.match(/```(?:json)?\s*(\[.*?\])\s*```/s);
      if (jsonMatch && jsonMatch[1]) {
        result = jsonMatch[1];
      } else {
        const arrayMatch = result.match(/\[.*\]/s);
        if (arrayMatch && arrayMatch[0]) {
          result = arrayMatch[0];
        }
      }

      const parsed = JSON.parse(result) as Array<{
        title: string;
        description?: string;
        dueDate?: string | Date;
        assigneeName?: string;
      }>;
      const tasks: ParsedTask[] = (Array.isArray(parsed) ? parsed : []).map((task) => {
        let dueDate: Date | undefined;
        if (task.dueDate) {
          if (task.dueDate instanceof Date) {
            dueDate = task.dueDate;
          } else if (typeof task.dueDate === "string") {
            try {
              const now = new Date();
              
              let parsedDate = chrono.parseDate(task.dueDate, now);
              
              if (!parsedDate) {
                const lowerDate = task.dueDate.toLowerCase().trim();
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(23, 59, 59, 999); 
                
                if (lowerDate === "завтра" || lowerDate === "tomorrow") {
                  parsedDate = tomorrow;
                } else if (lowerDate === "послезавтра" || lowerDate === "day after tomorrow") {
                  const dayAfter = new Date(now);
                  dayAfter.setDate(dayAfter.getDate() + 2);
                  dayAfter.setHours(23, 59, 59, 999);
                  parsedDate = dayAfter;
                } else if (lowerDate === "today" || lowerDate === "сегодня") {
                  logger.warn("GigaChat вернул 'today' вместо относительной даты", {
                    originalMessage: messageText.substring(0, 200),
                    dueDate: task.dueDate,
                    location: "extractTasks",
                  });
                  const today = new Date(now);
                  today.setHours(23, 59, 59, 999);
                  parsedDate = today;
                } else if (lowerDate.includes("через неделю") || lowerDate.includes("через 7 дней") || lowerDate === "через неделю" || lowerDate === "in a week" || lowerDate === "in 7 days") {
                  const weekLater = new Date(now);
                  weekLater.setDate(weekLater.getDate() + 7);
                  weekLater.setHours(23, 59, 59, 999);
                  parsedDate = weekLater;
                } else if (lowerDate.includes("через") && lowerDate.includes("день")) {
                  const daysMatch = lowerDate.match(/через\s+(\d+)\s+дн/i);
                  if (daysMatch && daysMatch[1]) {
                    const days = parseInt(daysMatch[1], 10);
                    if (!isNaN(days)) {
                      const futureDate = new Date(now);
                      futureDate.setDate(futureDate.getDate() + days);
                      futureDate.setHours(23, 59, 59, 999);
                      parsedDate = futureDate;
                    }
                  }
                } else if (lowerDate.includes("через") && lowerDate.includes("недел")) {
                  const weeksMatch = lowerDate.match(/через\s+(\d+)\s+недел/i);
                  if (weeksMatch && weeksMatch[1]) {
                    const weeks = parseInt(weeksMatch[1], 10);
                    if (!isNaN(weeks)) {
                      const futureDate = new Date(now);
                      futureDate.setDate(futureDate.getDate() + weeks * 7);
                      futureDate.setHours(23, 59, 59, 999);
                      parsedDate = futureDate;
                    }
                  }
                } else if (lowerDate.match(/in\s+(\d+)\s+days?/i)) {
                  const daysMatch = lowerDate.match(/in\s+(\d+)\s+days?/i);
                  if (daysMatch && daysMatch[1]) {
                    const days = parseInt(daysMatch[1], 10);
                    if (!isNaN(days)) {
                      const futureDate = new Date(now);
                      futureDate.setDate(futureDate.getDate() + days);
                      futureDate.setHours(23, 59, 59, 999);
                      parsedDate = futureDate;
                    }
                  }
                }
              }
              
              if (parsedDate) {
                dueDate = parsedDate;
              } else {
                const isoDate = new Date(task.dueDate);
                if (!isNaN(isoDate.getTime())) {
                  dueDate = isoDate;
                } else {
                  logger.warn("Не удалось распарсить дату из GigaChat", {
                    dueDate: task.dueDate,
                    location: "extractTasks",
                  });
                }
              }
            } catch (error) {
              logger.warn("Ошибка при парсинге даты из GigaChat", {
                error: error instanceof Error ? error.message : String(error),
                dueDate: task.dueDate,
                location: "extractTasks",
              });
            }
          }
        }
        
        return {
          title: task.title,
          description: task.description,
          dueDate,
          assigneeName: task.assigneeName,
        };
      });
      
      if (process.env.LOG_LEVEL === "debug" || tasks.length === 0) {
        logger.debug("GigaChat extractTasks parsed", {
          messageText: messageText.substring(0, 200),
          tasksCount: tasks.length,
          tasks: tasks.map((t) => ({
            title: t.title,
            dueDate: t.dueDate?.toISOString(),
            assigneeName: t.assigneeName,
          })),
          location: "extractTasks",
        });
      }
      
      return tasks;
    } catch (error) {
      logger.warn("Не удалось распарсить JSON задач из GigaChat", {
        error: error instanceof Error ? error.message : String(error),
        rawResponse: completion.result.substring(0, 500),
        messageText: messageText.substring(0, 200),
        location: "extractTasks",
      });
      return [];
    }
  }


  async analyzeMaterial(
    material: {
      title: string;
      type?: "image" | "file" | "video" | "share";
      fileName?: string;
      fileType?: string;
      link?: string;
    },
    context?: string,
  ): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    if (material.type && material.type !== "share" && material.type !== "file") {
      return null;
    }

    if (material.type === "file" && material.fileType) {
      const textFileTypes = [
        "text/",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
      ];
      
      const isTextFile = textFileTypes.some((type) => material.fileType?.startsWith(type));
      if (!isTextFile) {
        return null;
      }
    }

    try {
      const prompt = [
        "Ты — ассистент для анализа материалов из чата.",
        "",
        "ТВОЯ ЗАДАЧА:",
        "Создай краткую сводку (2-3 предложения) о материале на основе его названия, типа и контекста.",
        "",
        "ИНФОРМАЦИЯ О МАТЕРИАЛЕ:",
        `- Название: ${material.title}`,
        material.type ? `- Тип: ${material.type}` : "",
        material.fileName ? `- Имя файла: ${material.fileName}` : "",
        material.fileType ? `- Тип файла: ${material.fileType}` : "",
        material.link ? `- Ссылка: ${material.link}` : "",
        context ? `- Контекст: ${context.substring(0, 500)}` : "",
        "",
        "ТРЕБОВАНИЯ К СВОДКЕ:",
        "- Краткость: 2-3 предложения (максимум 150 символов)",
        "- Понятность: опиши, о чем материал, его назначение",
        "- Без лишних слов: только суть",
        "- Если информации недостаточно, верни краткое описание на основе названия",
        "",
        "ФОРМАТ ОТВЕТА:",
        "Просто текст сводки без дополнительных пояснений.",
      ]
        .filter(Boolean)
        .join("\n");

      const messages: ChatMessage[] = [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Создай краткую сводку для материала: "${material.title}"`,
        },
      ];

      const completion = await this.complete(messages, 0.3);
      const summary = completion.result.trim();

      if (summary.length > 200) {
        return summary.substring(0, 197) + "...";
      }

      return summary || null;
    } catch (error) {
      logger.warn("Ошибка анализа материала через GigaChat", {
        error: error instanceof Error ? error.message : String(error),
        material: material.title,
        location: "analyzeMaterial",
      });
      return null;
    }
  }

  async answerQuestion(
    question: string,
    context: string,
    options?: {
      chatId?: string | null;
      userId?: string;
      timezone?: string;
      chatMembers?: Array<{ id: string; name: string; username?: string }>;
    },
  ) {
    if (!this.enabled) {
      throw new Error("GigaChat integration is not configured");
    }

    const membersInfo = options?.chatMembers && options.chatMembers.length > 0
      ? [
          "",
          "УЧАСТНИКИ ЧАТА (для упоминания используй формат @username или имя):",
          formatBulletList(
            options.chatMembers.map((m) => {
              const parts = [m.name];
              if (m.username) parts.push(`@${m.username}`);
              return parts.join(" ");
            }),
          ),
        ].join("\n")
      : "";

    const systemPrompt = [
      "Ты — умный персональный ассистент студента в мессенджере MAX.",
      "",
      "ТВОИ ЗАДАЧИ:",
      "1. Отвечай на вопросы пользователя, используя ВСЮ предоставленную информацию",
      "2. Анализируй полную историю чата, задачи, дедлайны, материалы и участников",
      "3. Понимай контекст обсуждений из истории сообщений",
      "4. Знай всех участников чата, их имена и роли (активные/неактивные)",
      "5. При упоминании людей используй их имена или @username из списка участников",
      "6. Давай конкретные, полезные ответы с ссылками на материалы и упоминаниями людей",
      "7. Если вопрос про дедлайны — указывай точные даты, сколько дней осталось, и ответственных",
      "8. Если вопрос про материалы — перечисляй конкретные ссылки",
      "9. Если вопрос про задачи — группируй по дедлайнам и ответственным, упоминай людей",
      "10. Используй историю сообщений для понимания контекста и связей между событиями",
      "",
      "ПРАВИЛА ОТВЕТОВ:",
      "- Отвечай на русском языке, подробно и информативно",
      "- Анализируй ВСЮ историю чата для полного понимания контекста",
      "- При упоминании людей используй их реальные имена из списка участников",
      "- Если нужно упомянуть человека, используй формат: имя (@username если есть)",
      "- Если в контексте нет ответа, честно скажи об этом и предложи альтернативы",
      "- Если вопрос неясен, уточни, что именно интересует пользователя",
      "- Используй форматирование: списки, выделение важного",
      "- Если есть дедлайны — всегда указывай дату, сколько дней осталось, и ответственного",
      "- Если есть материалы — всегда указывай ссылки",
      "- Используй информацию о том, кто что говорил в истории чата",
      "",
      "СТРУКТУРА ОТВЕТА:",
      "- Начни с прямого ответа на вопрос",
      "- Подкрепи ответ конкретными данными из контекста (история, задачи, материалы)",
      "- Упоминай конкретных людей, если они связаны с вопросом",
      "- Если нужно, предложи следующие шаги с указанием ответственных",
      membersInfo,
    ]
      .filter(Boolean)
      .join("\n");

    const userMessage = [
      "КОНТЕКСТ (вся доступная информация):",
      context,
      "",
      "ВОПРОС ПОЛЬЗОВАТЕЛЯ:",
      question,
      "",
      "ВАЖНО: Используй ВСЮ информацию из контекста для ответа. Если в контексте есть последние сообщения — учитывай их для понимания текущей ситуации.",
    ].join("\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ];

    const completion = await this.complete(messages, 0.4);

    return completion.result.trim();
  }

  async checkMessageImportance(messageText: string): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "Ты — помощник для определения важности сообщений в учебном чате.",
          "",
          "ВАЖНОЕ СООБЩЕНИЕ содержит:",
          "- Дедлайны и сроки выполнения",
          "- Задачи и поручения",
          "- Назначения ответственных",
          "- Упоминания пользователей (@username)",
          "- Важные решения и изменения",
          "",
          "НЕ ВАЖНОЕ сообщение:",
          "- Обычный разговор",
          "- Вопросы без срочности",
          "- Обсуждения без конкретных действий",
          "",
          "Ответь ТОЛЬКО 'true' или 'false', без дополнительных объяснений.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Сообщение для анализа:\n${messageText}`,
      },
    ];

    try {
      const completion = await this.complete(messages, 0.1);
      const result = completion.result.trim().toLowerCase();
      return result === "true" || result.includes("true");
    } catch (error) {
      logger.warn("Ошибка проверки важности сообщения", { error, location: "checkMessageImportance" });
      return false;
    }
  }
}

export const gigaChatService = new GigaChatService();
