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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2_000),
  WORKER_HEARTBEAT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_URL: z.string().min(1),
  UPLOAD_DIRECTORY: z.string().min(1).default("/var/uploads"),
  SITE_DIRECTORY: z.string().min(1).default("/var/www/sites"),
  BACKUP_DIRECTORY: z.string().min(1).default("/var/backups"),
  LOG_DIRECTORY: z.string().min(1).default("/var/log/hosting"),
  TEMP_DIRECTORY: z.string().min(1).default(ENGINE_DEFAULTS.TEMP_DIRECTORY),
  PUBLIC_BASE_DOMAIN: z.string().min(1).default(ENGINE_DEFAULTS.PUBLIC_BASE_DOMAIN),
  NGINX_PORT: z.coerce.number().int().positive().max(65_535).default(ENGINE_DEFAULTS.NGINX_PORT),
  NGINX_BIN: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_BIN),
  NGINX_SITES_AVAILABLE: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_SITES_AVAILABLE),
  NGINX_SITES_ENABLED: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_SITES_ENABLED),
  NGINX_TEMP_DIR: z.string().min(1).default(ENGINE_DEFAULTS.TEMP_DIRECTORY),
  NGINX_SERVE_ROOT: z.string().min(1),
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
  VERSION_RETENTION: z.coerce.number().int().positive().default(ENGINE_DEFAULTS.VERSION_RETENTION),
  TEMP_AGE_HOURS: z.coerce.number().int().positive().default(ENGINE_DEFAULTS.TEMP_AGE_HOURS),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  STALE_AFTER_MINUTES: z.coerce.number().int().positive().default(10),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  return envSchema.parse(source);
}

export const env = loadEnv(process.env);
