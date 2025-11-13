import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  MAX_BOT_TOKEN: z.string().min(1, "MAX_BOT_TOKEN is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GIGACHAT_CLIENT_ID: z.string().optional(),
  GIGACHAT_CLIENT_SECRET: z.string().optional(),
  GIGACHAT_AUTHORIZATION_KEY: z.string().optional(),
  GIGACHAT_SCOPE: z.string().default("GIGACHAT_API_PERS"),
  GIGACHAT_AUTH_URL: z
    .string()
    .default("https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
  GIGACHAT_BASE_URL: z
    .string()
    .default("https://gigachat.devices.sberbank.ru/api/v1"),
  GIGACHAT_MODEL: z.string().default("GigaChat-Pro"),
  GIGACHAT_CA_CERT_PATH: z.string().default(
    "certs/russian_trusted_root_ca_pem.crt;certs/russian_trusted_sub_ca_pem.crt",
  ),
  GIGACHAT_TLS_INSECURE: z.coerce.boolean().default(false),
  DIGEST_MAX_MESSAGES: z.coerce.number().default(200),
  DEFAULT_TIMEZONE: z.string().default("Europe/Moscow"),
});

const rawEnv = envSchema.safeParse(process.env);

if (!rawEnv.success) {
  console.error("Invalid environment configuration:", rawEnv.error.flatten().fieldErrors);
  throw new Error("Environment validation failed");
}

export type AppConfig = z.infer<typeof envSchema>;

export const appConfig: AppConfig = rawEnv.data;

export const isGigaChatEnabled = Boolean(
  appConfig.GIGACHAT_AUTHORIZATION_KEY || (appConfig.GIGACHAT_CLIENT_ID && appConfig.GIGACHAT_CLIENT_SECRET),
);

