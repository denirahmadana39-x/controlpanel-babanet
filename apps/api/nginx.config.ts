import { z } from "zod";

const nginxApiConfigSchema = z.object({
  baseDomain: z.string().min(1),
  port: z.number().int().positive().max(65_535),
  serveRoot: z.string().min(1),
});

export type NginxApiConfig = z.infer<typeof nginxApiConfigSchema>;

export function buildNginxApiConfig(source: NodeJS.ProcessEnv): NginxApiConfig {
  return nginxApiConfigSchema.parse({
    baseDomain: source.PUBLIC_BASE_DOMAIN,
    port: Number(source.NGINX_PORT),
    serveRoot: source.SITE_DIRECTORY,
  });
}

export function defaultHostname(projectName: string, config: NginxApiConfig): string {
  return `${projectName}.${config.baseDomain}`;
}

export function siteUrl(hostname: string, config: NginxApiConfig): string {
  const port = config.port === 80 ? "" : `:${config.port}`;
  return `http://${hostname}${port}`;
}
