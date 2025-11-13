"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGigaChatEnabled = exports.appConfig = void 0;
const dotenv_1 = require("dotenv");
const zod_1 = require("zod");
(0, dotenv_1.config)();
const envSchema = zod_1.z.object({
    MAX_BOT_TOKEN: zod_1.z.string().min(1, "MAX_BOT_TOKEN is required"),
    DATABASE_URL: zod_1.z.string().min(1, "DATABASE_URL is required"),
    GIGACHAT_CLIENT_ID: zod_1.z.string().optional(),
    GIGACHAT_CLIENT_SECRET: zod_1.z.string().optional(),
    GIGACHAT_AUTHORIZATION_KEY: zod_1.z.string().optional(),
    GIGACHAT_SCOPE: zod_1.z.string().default("GIGACHAT_API_PERS"),
    GIGACHAT_AUTH_URL: zod_1.z
        .string()
        .default("https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
    GIGACHAT_BASE_URL: zod_1.z
        .string()
        .default("https://gigachat.devices.sberbank.ru/api/v1"),
    GIGACHAT_MODEL: zod_1.z.string().default("GigaChat-Pro"),
    GIGACHAT_CA_CERT_PATH: zod_1.z.string().default("certs/russian_trusted_root_ca_pem.crt;certs/russian_trusted_sub_ca_pem.crt"),
    GIGACHAT_TLS_INSECURE: zod_1.z.coerce.boolean().default(false),
    DIGEST_MAX_MESSAGES: zod_1.z.coerce.number().default(200),
    DEFAULT_TIMEZONE: zod_1.z.string().default("Europe/Moscow"),
});
const rawEnv = envSchema.safeParse(process.env);
if (!rawEnv.success) {
    console.error("Invalid environment configuration:", rawEnv.error.flatten().fieldErrors);
    throw new Error("Environment validation failed");
}
exports.appConfig = rawEnv.data;
exports.isGigaChatEnabled = Boolean(exports.appConfig.GIGACHAT_AUTHORIZATION_KEY || (exports.appConfig.GIGACHAT_CLIENT_ID && exports.appConfig.GIGACHAT_CLIENT_SECRET));
//# sourceMappingURL=config.js.map