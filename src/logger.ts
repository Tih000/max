import pino from "pino";

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

// Упрощенное логирование для пользовательских действий
export const logger = {
  // Логирование действий пользователя
  userAction: (userId: number | string | undefined, action: string, details?: Record<string, unknown>) => {
    const userInfo = userId ? `[User:${userId}]` : "[User:unknown]";
    baseLogger.info({ userId, action, ...details }, `${userInfo} ${action}`);
  },

  // Логирование команд
  command: (userId: number | string | undefined, command: string, chatId?: number | string) => {
    const userInfo = userId ? `[User:${userId}]` : "[User:unknown]";
    const chatInfo = chatId ? ` [Chat:${chatId}]` : "";
    baseLogger.info({ userId, command, chatId }, `${userInfo}${chatInfo} → /${command}`);
  },

  // Логирование ошибок с контекстом
  error: (message: string, context?: { userId?: number | string; action?: string; error?: unknown; location?: string; [key: string]: unknown }) => {
    const userInfo = context?.userId ? `[User:${context.userId}]` : "";
    const actionInfo = context?.action ? ` [Action:${context.action}]` : "";
    const locationInfo = context?.location ? ` [Location:${context.location}]` : "";
    const errorInfo = context?.error instanceof Error ? context.error.message : String(context?.error ?? "");
    
    baseLogger.error(
      context ?? {},
      `${userInfo}${actionInfo}${locationInfo} ❌ ${message}${errorInfo ? `: ${errorInfo}` : ""}`,
    );
  },

  // Логирование успешных операций
  success: (message: string, context?: { userId?: number | string; action?: string; [key: string]: unknown }) => {
    const userInfo = context?.userId ? `[User:${context.userId}]` : "";
    const actionInfo = context?.action ? ` [Action:${context.action}]` : "";
    baseLogger.info(context ?? {}, `${userInfo}${actionInfo} ✅ ${message}`);
  },

  // Логирование предупреждений
  warn: (message: string, context?: { userId?: number | string; action?: string; location?: string; [key: string]: unknown }) => {
    const userInfo = context?.userId ? `[User:${context.userId}]` : "";
    const actionInfo = context?.action ? ` [Action:${context.action}]` : "";
    const locationInfo = context?.location ? ` [Location:${context.location}]` : "";
    baseLogger.warn(context ?? {}, `${userInfo}${actionInfo}${locationInfo} ⚠️ ${message}`);
  },

  // Логирование системных событий
  system: (message: string, details?: Record<string, unknown>) => {
    baseLogger.info(details, `[System] ${message}`);
  },

  // Логирование для отладки (только в dev режиме)
  debug: (message: string, context?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === "debug") {
      baseLogger.debug(context, `[Debug] ${message}`);
    }
  },

  // Прямой доступ к базовым методам для совместимости
  info: (context: Record<string, unknown>, message: string) => {
    baseLogger.info(context, message);
  },

  // Прямой доступ к базовому логгеру для особых случаев
  raw: baseLogger,
};

