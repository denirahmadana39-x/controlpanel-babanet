import { COOKIE_NAMES } from "@hosting/auth";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { strongPasswordSchema } from "../../validation/password.js";
import { assertUser, requireAuth, requireCsrf } from "./guards.js";

const loginBodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().optional(),
});

const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: strongPasswordSchema,
});

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  sessionId: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

const sessionResponseSchema = z.object({
  user: userSchema,
  csrfToken: z.string(),
  expiresIn: z.number(),
});

const LOGIN_RATE_LIMIT = { max: 5, timeWindow: 15 * 60 * 1000 };
const REFRESH_RATE_LIMIT = { max: 10, timeWindow: 15 * 60 * 1000 };

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post("/api/auth/login", {
    config: { rateLimit: LOGIN_RATE_LIMIT },
    schema: {
      body: loginBodySchema,
      response: { 200: sessionResponseSchema },
    },
    handler: async (request, reply) => {
      const { email, password, rememberMe } = request.body;
      const result = await request.server.authService.login(
        email,
        password,
        rememberMe ?? false,
        request,
      );
      const sessionMaxAgeSeconds = request.server.authService.sessionExpirySeconds(
        rememberMe ?? false,
      );
      const csrfToken = request.server.authService.setSessionCookies(
        reply,
        result.accessToken,
        result.refreshToken,
        sessionMaxAgeSeconds,
      );
      return { user: result.user, csrfToken, expiresIn: result.expiresIn };
    },
  });

  typed.post("/api/auth/refresh", {
    config: { rateLimit: REFRESH_RATE_LIMIT },
    schema: {
      response: { 200: sessionResponseSchema },
    },
    handler: async (request, reply) => {
      const refreshToken = request.cookies?.[COOKIE_NAMES.refreshToken];
      if (!refreshToken) {
        throw new AppError(401, "MISSING_REFRESH_TOKEN", "Refresh token is required");
      }
      const result = await request.server.authService.refresh(refreshToken, request);
      const csrfToken = request.server.authService.setSessionCookies(
        reply,
        result.accessToken,
        result.refreshToken,
        result.expiresIn,
      );
      return { user: result.user, csrfToken, expiresIn: result.expiresIn };
    },
  });

  typed.post("/api/auth/logout", {
    preHandler: [requireAuth(), requireCsrf],
    handler: async (request, reply) => {
      const refreshToken = request.cookies?.[COOKIE_NAMES.refreshToken];
      await request.server.authService.logout(refreshToken, request);
      request.server.authService.clearSessionCookies(reply);
      reply.code(204).send();
    },
  });

  typed.post("/api/auth/change-password", {
    schema: {
      body: changePasswordBodySchema,
    },
    preHandler: [requireAuth(), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const { currentPassword, newPassword } = request.body;
      await request.server.authService.changePassword(
        user.id,
        user.sessionId,
        currentPassword,
        newPassword,
        request,
      );
      reply.code(204).send();
    },
  });

  typed.get("/api/auth/me", {
    schema: {
      response: { 200: z.object({ user: userSchema, csrfToken: z.string() }) },
    },
    preHandler: requireAuth(),
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const existing = request.cookies?.[COOKIE_NAMES.csrfToken];
      const csrfToken =
        existing ??
        request.server.authService.rotateCsrf(
          reply,
          request.server.authService.sessionExpirySeconds(false),
        );
      return { user, csrfToken };
    },
  });
}
