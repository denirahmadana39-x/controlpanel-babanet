import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ENGINE_DEFAULTS } from "@hosting/shared";

const currentDir = dirname(fileURLToPath(import.meta.url));
config({
  path: [
    resolve(process.cwd(), ".env"),
    resolve(currentDir, "../../../../.env"),
    resolve(currentDir, "../../../.env"),
    resolve(currentDir, "../../.env"),
  ],
  quiet: true,
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default("hosting-panel"),
  JWT_AUDIENCE: z.string().min(1).default("hosting-panel-api"),
  ACCESS_TOKEN_TTL: z.string().min(2).default("15m"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  REMEMBER_ME_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  CORS_ORIGINS: z.string().min(1).default("http://localhost:5173,http://localhost:5174"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  API_URL: z.string().url().default("http://localhost:3000"),
  UPLOAD_DIRECTORY: z.string().min(1).default("./data/uploads"),
  SITE_DIRECTORY: z.string().min(1).default("./data/sites"),
  BACKUP_DIRECTORY: z.string().min(1).default("./data/backups"),
  LOG_DIRECTORY: z.string().min(1).default("./data/logs"),
  TEMP_DIRECTORY: z.string().min(1).default(ENGINE_DEFAULTS.TEMP_DIRECTORY),
  PUBLIC_BASE_DOMAIN: z.string().min(1).default(ENGINE_DEFAULTS.PUBLIC_BASE_DOMAIN),
  NGINX_PORT: z.coerce.number().int().positive().max(65_535).default(ENGINE_DEFAULTS.NGINX_PORT),
  NGINX_BIN: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_BIN),
  NGINX_SITES_AVAILABLE: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_SITES_AVAILABLE),
  NGINX_SITES_ENABLED: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_SITES_ENABLED),
  UPLOAD_MAX_SIZE_MB: z.coerce
    .number()
    .int()
    .positive()
    .default(ENGINE_DEFAULTS.UPLOAD_MAX_SIZE_MB),
  MAX_ZIP_ENTRIES: z.coerce.number().int().positive().default(ENGINE_DEFAULTS.MAX_ZIP_ENTRIES),
  MAX_EXTRACTED_SIZE_MB: z.coerce
    .number()
    .int()
    .positive()
    .default(ENGINE_DEFAULTS.MAX_EXTRACTED_SIZE_MB),
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv): ApiEnv {
  return envSchema.parse(env);
}

export const env = loadEnv(process.env);
