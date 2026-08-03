import { join } from "node:path";
import type { Database } from "@hosting/database";
import { generateSiteConfig, type NginxController } from "@hosting/nginx";
import type { NginxApiConfig } from "../../nginx.config.js";
import { defaultHostname } from "../../nginx.config.js";

export class SiteConfigService {
  readonly config: NginxApiConfig;

  constructor(
    private readonly db: Database,
    private readonly nginx: NginxController,
    config: NginxApiConfig,
  ) {
    this.config = config;
  }

  async hostnamesForProject(projectId: string, projectName: string): Promise<string[]> {
    const domains = await this.db.domains.listByProject(projectId);
    const custom = domains.map((domain) => domain.hostname);
    return [defaultHostname(projectName, this.config), ...custom];
  }

  async primaryHostname(projectId: string, projectName: string): Promise<string> {
    const domains = await this.db.domains.listByProject(projectId);
    const primary = domains.find((domain) => domain.isPrimary) ?? domains[0];
    return primary ? primary.hostname : defaultHostname(projectName, this.config);
  }

  async syncSiteConfig(projectId: string, projectName: string): Promise<void> {
    const existing = await this.nginx.readSiteConfig(projectId);
    const hasDeployment = (await this.db.deployments.findActiveByProject(projectId)) !== null;
    if (existing === null && !hasDeployment) return;

    const hostnames = await this.hostnamesForProject(projectId, projectName);
    const content = generateSiteConfig({
      projectId,
      hostnames,
      root: join(this.config.serveRoot, projectId),
      port: this.config.port,
    });
    try {
      await this.nginx.applySiteConfig(projectId, content);
    } catch (error) {
      if (existing !== null) {
        await this.nginx.applySiteConfig(projectId, existing);
      }
      throw error;
    }
  }

  async removeSiteConfig(projectId: string): Promise<void> {
    await this.nginx.removeSite(projectId);
  }
}
