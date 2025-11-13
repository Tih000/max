"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const baseLogger = (0, pino_1.default)({
    level: process.env.LOG_LEVEL ?? "info",
});
// Упрощенное логирование для пользовательских действий
exports.logger = {
    // Логирование действий пользователя
    userAction: (userId, action, details) => {
        const userInfo = userId ? `[User:${userId}]` : "[User:unknown]";
        baseLogger.info({ userId, action, ...details }, `${userInfo} ${action}`);
    },
    // Логирование команд
    command: (userId, command, chatId) => {
        const userInfo = userId ? `[User:${userId}]` : "[User:unknown]";
        const chatInfo = chatId ? ` [Chat:${chatId}]` : "";
        baseLogger.info({ userId, command, chatId }, `${userInfo}${chatInfo} → /${command}`);
    },
    // Логирование ошибок с контекстом
    error: (message, context) => {
        const userInfo = context?.userId ? `[User:${context.userId}]` : "";
        const actionInfo = context?.action ? ` [Action:${context.action}]` : "";
        const locationInfo = context?.location ? ` [Location:${context.location}]` : "";
        const errorInfo = context?.error instanceof Error ? context.error.message : String(context?.error ?? "");
        baseLogger.error(context ?? {}, `${userInfo}${actionInfo}${locationInfo} ❌ ${message}${errorInfo ? `: ${errorInfo}` : ""}`);
    },
    // Логирование успешных операций
    success: (message, context) => {
        const userInfo = context?.userId ? `[User:${context.userId}]` : "";
        const actionInfo = context?.action ? ` [Action:${context.action}]` : "";
        baseLogger.info(context ?? {}, `${userInfo}${actionInfo} ✅ ${message}`);
    },
    // Логирование предупреждений
    warn: (message, context) => {
        const userInfo = context?.userId ? `[User:${context.userId}]` : "";
        const actionInfo = context?.action ? ` [Action:${context.action}]` : "";
        const locationInfo = context?.location ? ` [Location:${context.location}]` : "";
        baseLogger.warn(context ?? {}, `${userInfo}${actionInfo}${locationInfo} ⚠️ ${message}`);
    },
    // Логирование системных событий
    system: (message, details) => {
        baseLogger.info(details, `[System] ${message}`);
    },
    // Логирование для отладки (только в dev режиме)
    debug: (message, context) => {
        if (process.env.LOG_LEVEL === "debug") {
            baseLogger.debug(context, `[Debug] ${message}`);
        }
    },
    // Прямой доступ к базовым методам для совместимости
    info: (context, message) => {
        baseLogger.info(context, message);
    },
    // Прямой доступ к базовому логгеру для особых случаев
    raw: baseLogger,
};
//# sourceMappingURL=logger.js.map