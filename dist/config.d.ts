import { z } from "zod";
declare const envSchema: z.ZodObject<{
    MAX_BOT_TOKEN: z.ZodString;
    DATABASE_URL: z.ZodString;
    GIGACHAT_CLIENT_ID: z.ZodOptional<z.ZodString>;
    GIGACHAT_CLIENT_SECRET: z.ZodOptional<z.ZodString>;
    GIGACHAT_AUTHORIZATION_KEY: z.ZodOptional<z.ZodString>;
    GIGACHAT_SCOPE: z.ZodDefault<z.ZodString>;
    GIGACHAT_AUTH_URL: z.ZodDefault<z.ZodString>;
    GIGACHAT_BASE_URL: z.ZodDefault<z.ZodString>;
    GIGACHAT_MODEL: z.ZodDefault<z.ZodString>;
    GIGACHAT_CA_CERT_PATH: z.ZodDefault<z.ZodString>;
    GIGACHAT_TLS_INSECURE: z.ZodDefault<z.ZodCoercedBoolean<unknown>>;
    DIGEST_MAX_MESSAGES: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    DEFAULT_TIMEZONE: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type AppConfig = z.infer<typeof envSchema>;
export declare const appConfig: AppConfig;
export declare const isGigaChatEnabled: boolean;
export {};
//# sourceMappingURL=config.d.ts.map