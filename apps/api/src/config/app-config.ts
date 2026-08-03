import type { AuthConfig } from "@hosting/auth";
import type { DatabaseConfig } from "@hosting/database";
import type { NginxApiConfig } from "../../nginx.config.js";
import type { ApiEnv } from "./env.js";

const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

function parseTtlSeconds(ttl: string): number {
  const match = /^(\d+)([smhdw])$/.exec(ttl);
  if (!match) return DEFAULT_ACCESS_TTL_SECONDS;
  const value = Number(match[1]);
  const factors: Record<string, number> = {
    s: 1,
    m: 60,
    h: SECONDS_PER_HOUR,
    d: SECONDS_PER_DAY,
    w: 604_800,
  };
  const factor = factors[match[2] ?? ""];
  if (factor === undefined) return DEFAULT_ACCESS_TTL_SECONDS;
  return value * factor;
}

export interface AppConfig {
  auth: AuthConfig;
  database: DatabaseConfig;
  corsOrigins: string[];
  app: {
    appUrl: string;
    apiUrl: string;
  };
  paths: {
    uploadDirectory: string;
    siteDirectory: string;
    backupDirectory: string;
    logDirectory: string;
    tempDirectory: string;
  };
  nginx: NginxApiConfig;
  limits: {
    maxUploadSizeMb: number;
    maxZipEntries: number;
    maxExtractedSizeMb: number;
  };
}

export function buildAppConfig(env: ApiEnv): AppConfig {
  return {
    auth: {
      accessToken: {
        secret: env.JWT_SECRET,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        ttl: env.ACCESS_TOKEN_TTL,
      },
      refreshToken: {
        secret: env.JWT_REFRESH_SECRET,
      },
      cookies: {
        secure: env.COOKIE_SECURE,
        sameSite: env.COOKIE_SAME_SITE,
        accessTokenMaxAgeSeconds: parseTtlSeconds(env.ACCESS_TOKEN_TTL),
        sessionMaxAgeSeconds: env.SESSION_TTL_HOURS * SECONDS_PER_HOUR,
        rememberMeSessionMaxAgeSeconds: env.REMEMBER_ME_TTL_DAYS * SECONDS_PER_DAY,
      },
    },
    database: {
      connectionString: env.DATABASE_URL,
    },
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    app: {
      appUrl: env.APP_URL,
      apiUrl: env.API_URL,
    },
    paths: {
      uploadDirectory: env.UPLOAD_DIRECTORY,
      siteDirectory: env.SITE_DIRECTORY,
      backupDirectory: env.BACKUP_DIRECTORY,
      logDirectory: env.LOG_DIRECTORY,
      tempDirectory: env.TEMP_DIRECTORY,
    },
    nginx: {
      baseDomain: env.PUBLIC_BASE_DOMAIN,
      port: env.NGINX_PORT,
      serveRoot: env.SITE_DIRECTORY,
    },
    limits: {
      maxUploadSizeMb: env.UPLOAD_MAX_SIZE_MB,
      maxZipEntries: env.MAX_ZIP_ENTRIES,
      maxExtractedSizeMb: env.MAX_EXTRACTED_SIZE_MB,
    },
  };
}
