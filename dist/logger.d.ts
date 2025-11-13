import pino from "pino";
export declare const logger: {
    userAction: (userId: number | string | undefined, action: string, details?: Record<string, unknown>) => void;
    command: (userId: number | string | undefined, command: string, chatId?: number | string) => void;
    error: (message: string, context?: {
        userId?: number | string;
        action?: string;
        error?: unknown;
        location?: string;
        [key: string]: unknown;
    }) => void;
    success: (message: string, context?: {
        userId?: number | string;
        action?: string;
        [key: string]: unknown;
    }) => void;
    warn: (message: string, context?: {
        userId?: number | string;
        action?: string;
        location?: string;
        [key: string]: unknown;
    }) => void;
    system: (message: string, details?: Record<string, unknown>) => void;
    debug: (message: string, context?: Record<string, unknown>) => void;
    info: (context: Record<string, unknown>, message: string) => void;
    raw: pino.Logger<never, boolean>;
};
//# sourceMappingURL=logger.d.ts.map