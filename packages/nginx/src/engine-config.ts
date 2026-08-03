import { z } from "zod";
import { ENGINE_DEFAULTS } from "@hosting/shared";

export const nginxEngineConfigSchema = z.object({
  binary: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_BIN),
  sitesAvailableDir: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_SITES_AVAILABLE),
  sitesEnabledDir: z.string().min(1).default(ENGINE_DEFAULTS.NGINX_SITES_ENABLED),
  tempDir: z.string().min(1).default(ENGINE_DEFAULTS.TEMP_DIRECTORY),
  serveRoot: z.string().min(1),
  baseDomain: z.string().min(1).default(ENGINE_DEFAULTS.PUBLIC_BASE_DOMAIN),
  port: z.coerce.number().int().positive().max(65_535).default(ENGINE_DEFAULTS.NGINX_PORT),
});

export type NginxEngineConfig = z.infer<typeof nginxEngineConfigSchema>;

export interface NginxEngineConfigOverrides {
  serveRoot?: string;
  tempDir?: string;
}

export interface NginxEngineEnvSource {
  NGINX_BIN?: string | undefined;
  NGINX_SITES_AVAILABLE?: string | undefined;
  NGINX_SITES_ENABLED?: string | undefined;
  NGINX_TEMP_DIR?: string | undefined;
  NGINX_SERVE_ROOT?: string | undefined;
  PUBLIC_BASE_DOMAIN?: string | undefined;
  NGINX_PORT?: string | number | undefined;
}

/**
 * Loads and validates nginx engine config from the environment. Callers may
 * override `serveRoot`/`tempDir` when those come from a validated app config
 * rather than raw environment variables.
 */
export function loadNginxEngineConfig(
  source: NginxEngineEnvSource,
  overrides: NginxEngineConfigOverrides = {},
): NginxEngineConfig {
  return nginxEngineConfigSchema.parse({
    binary: source.NGINX_BIN,
    sitesAvailableDir: source.NGINX_SITES_AVAILABLE,
    sitesEnabledDir: source.NGINX_SITES_ENABLED,
    tempDir: source.NGINX_TEMP_DIR,
    serveRoot: source.NGINX_SERVE_ROOT,
    baseDomain: source.PUBLIC_BASE_DOMAIN,
    port: source.NGINX_PORT,
    ...overrides,
  });
}
