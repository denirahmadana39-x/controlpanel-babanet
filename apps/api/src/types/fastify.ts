import type { AuthService } from "@hosting/auth";
import type { Database } from "@hosting/database";
import type { NginxController } from "@hosting/nginx";
import type { MetricsRegistry } from "@hosting/monitoring";
import type { HostingLogger } from "@hosting/logger";
import type { StorageManager } from "@hosting/storage";
import type { AuthService as ApplicationAuthService } from "../modules/auth/auth.service.js";
import type { AuditService } from "../services/audit.service.js";
import type { SiteConfigService } from "../services/site-config.service.js";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    authVia?: "cookie" | "header";
  }
  interface FastifyInstance {
    db: Database;
    auth: AuthService;
    authService: ApplicationAuthService;
    audit: AuditService;
    storage: StorageManager;
    nginx: NginxController;
    siteConfig: SiteConfigService;
    metrics: MetricsRegistry;
    fileLog: HostingLogger;
  }
}
