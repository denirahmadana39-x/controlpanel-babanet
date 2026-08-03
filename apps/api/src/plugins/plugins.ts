import { createAuthService, type AuthConfig, type AuthService } from "@hosting/auth";
import { createDatabase, type Database, type DatabaseConfig } from "@hosting/database";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export interface PluginOptions {
  authConfig: AuthConfig;
  databaseConfig: DatabaseConfig;
  corsOrigins: string[];
}

export async function registerPlugins(app: FastifyInstance, options: PluginOptions): Promise<void> {
  app.register(fastifyCookie, {
    parseOptions: {
      httpOnly: true,
      secure: options.authConfig.cookies.secure,
      sameSite: options.authConfig.cookies.sameSite,
      path: "/",
    },
  });

  app.register(fastifyCors, {
    origin: options.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  });

  app.register(fastifyHelmet, {
    global: true,
  });

  app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: 60_000,
  });

  const auth: AuthService = createAuthService(options.authConfig);
  const db: Database = createDatabase(options.databaseConfig);

  app.decorate("auth", auth);
  app.decorate("db", db);
}
