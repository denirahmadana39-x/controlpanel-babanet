import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { metrics } from "@hosting/monitoring";
import { createLogger } from "@hosting/logger";
import { NginxController } from "@hosting/nginx";
import { StorageManager } from "@hosting/storage";
import { env } from "./config/env.js";
import { buildAppConfig } from "./config/app-config.js";
import { loadNginxEngineConfig } from "@hosting/nginx";
import { createErrorHandler } from "./errors/error-handler.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { registerDeploymentsRoutes } from "./modules/deployments/deployments.routes.js";
import { registerDomainsRoutes } from "./modules/domains/domains.routes.js";
import { registerFilesRoutes } from "./modules/files/files.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { registerMonitoringRoutes } from "./modules/monitoring/monitoring.routes.js";
import { registerProjectsRoutes } from "./modules/projects/projects.routes.js";
import { registerUsersRoutes } from "./modules/users/users.routes.js";
import { registerPlugins } from "./plugins/plugins.js";
import { AuditService } from "./services/audit.service.js";
import { SiteConfigService } from "./services/site-config.service.js";

export interface BuildAppOptions {
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? { level: env.LOG_LEVEL },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(createErrorHandler(app));

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  const config = buildAppConfig(env);
  await registerPlugins(app, {
    authConfig: config.auth,
    databaseConfig: config.database,
    corsOrigins: config.corsOrigins,
  });
  app.register(fastifyMultipart, {
    limits: {
      fileSize: config.limits.maxUploadSizeMb * 1024 * 1024,
      files: 1,
      fields: 1,
    },
  });

  const storage = new StorageManager({
    uploadDirectory: config.paths.uploadDirectory,
    siteDirectory: config.paths.siteDirectory,
    backupDirectory: config.paths.backupDirectory,
    tempDirectory: config.paths.tempDirectory,
  });
  storage.ensureRoots();

  const nginx = new NginxController(
    loadNginxEngineConfig(
      {
        NGINX_BIN: env.NGINX_BIN,
        NGINX_SITES_AVAILABLE: env.NGINX_SITES_AVAILABLE,
        NGINX_SITES_ENABLED: env.NGINX_SITES_ENABLED,
        PUBLIC_BASE_DOMAIN: env.PUBLIC_BASE_DOMAIN,
        NGINX_PORT: env.NGINX_PORT,
      },
      {
        serveRoot: config.paths.siteDirectory,
        tempDir: config.paths.tempDirectory,
      },
    ),
  );

  app.decorate("audit", new AuditService(app.db));
  app.decorate("storage", storage);
  app.decorate("nginx", nginx);
  app.decorate("siteConfig", new SiteConfigService(app.db, nginx, config.nginx));
  app.decorate("metrics", metrics);
  app.decorate(
    "fileLog",
    createLogger({ directory: config.paths.logDirectory, level: env.LOG_LEVEL }),
  );

  const requestDuration = metrics.histogram("api_request_duration_seconds");
  const requestTotal = metrics.counter("api_requests_total");
  app.addHook("onResponse", async (request, reply) => {
    requestTotal.inc(1, {
      method: request.method,
      status: String(reply.statusCode),
    });
    requestDuration.observe(reply.elapsedTime / 1000, {
      method: request.method,
      route: request.routeOptions?.url ?? request.url.split("?")[0] ?? "unknown",
      status: String(reply.statusCode),
    });
    app.fileLog.access(request.method, {
      reqId: request.id,
      route: request.routeOptions?.url ?? null,
      url: request.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      remoteAddress: request.ip,
    });
  });

  const authService = createAuthService(app);
  app.decorate("authService", authService);
  app.addHook("onRequest", (request) => authService.authenticate(request));

  app.register(registerHealthRoutes);
  app.register(registerAuthRoutes);
  app.register(registerUsersRoutes);
  app.register(registerProjectsRoutes);
  app.register(registerDeploymentsRoutes);
  app.register(registerDomainsRoutes);
  app.register(registerFilesRoutes);
  app.register(registerDashboardRoutes);
  app.register(registerMonitoringRoutes);

  return app;
}
