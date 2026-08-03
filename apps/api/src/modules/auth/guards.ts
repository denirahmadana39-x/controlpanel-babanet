import type { FastifyRequest } from "fastify";
import type { AuthUser } from "../../types/fastify.js";
import { AppError } from "../../errors/app-error.js";

export type RequireAuth = ReturnType<typeof requireAuth>;

export function requireAuth(): (request: FastifyRequest) => Promise<void> {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.user) {
      throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
    }
  };
}

export function requirePermissions(required: string[]): (request: FastifyRequest) => Promise<void> {
  return async (request: FastifyRequest): Promise<void> => {
    const user = assertUser(request.user);
    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length > 0) {
      throw new AppError(403, "FORBIDDEN", "Insufficient permissions");
    }
  };
}

export async function requireCsrf(request: FastifyRequest): Promise<void> {
  if (request.authVia === "cookie") {
    request.server.authService.validateCsrf(request);
  }
}

export function assertUser(user: AuthUser | undefined): AuthUser {
  if (!user) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
  }
  return user;
}
