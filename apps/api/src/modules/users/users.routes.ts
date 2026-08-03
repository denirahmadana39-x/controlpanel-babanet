import type { UserWithRoles } from "@hosting/database";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { strongPasswordSchema } from "../../validation/password.js";
import { requireCsrf, requirePermissions } from "../auth/guards.js";
import { PERMISSION_CODES } from "@hosting/shared";

const PERMISSION = PERMISSION_CODES.USERS_MANAGE;
const guard = requirePermissions([PERMISSION]);

const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const createUserBodySchema = z.object({
  email: z.string().email().max(254),
  password: strongPasswordSchema,
  displayName: z.string().min(1).max(100),
  roles: z.array(z.string()).optional(),
});

const updateUserBodySchema = z.object({
  email: z.string().email().max(254).optional(),
  password: strongPasswordSchema.optional(),
  displayName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

const setRolesBodySchema = z.object({
  roleCodes: z.array(z.string().min(1)).min(1),
});

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  roles: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      description: z.string().nullable(),
    }),
  ),
});

const listUsersResponseSchema = z.object({
  users: z.array(userSchema),
});

const userResponseSchema = z.object({
  user: userSchema,
});

export async function registerUsersRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get("/api/users", {
    schema: {
      response: { 200: listUsersResponseSchema },
    },
    preHandler: guard,
    handler: async () => {
      const users = await app.db.users.list();
      return { users: users.map(serializeUser) };
    },
  });

  typed.get("/api/users/:id", {
    schema: {
      params: userIdParamsSchema,
      response: { 200: userResponseSchema },
    },
    preHandler: guard,
    handler: async (request) => {
      const user = await app.db.users.findById(request.params.id);
      if (!user) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }
      return { user: serializeUser(user) };
    },
  });

  typed.post("/api/users", {
    schema: {
      body: createUserBodySchema,
      response: { 201: userResponseSchema },
    },
    preHandler: [guard, requireCsrf],
    handler: async (request, reply) => {
      const { email, password, displayName, roles } = request.body;
      const passwordHash = await app.auth.hashPassword(password);
      const created = await app.db.users.create({ email, passwordHash, displayName });
      if (roles && roles.length > 0) {
        await app.db.users.setRoles(created.id, roles);
      }
      const user = await app.db.users.findById(created.id);
      if (!user) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }
      await app.audit.audit(
        {
          ...(request.user ? { userId: request.user.id } : {}),
          action: "user_created",
          entityType: "user",
          entityId: created.id,
          metadata: { email, roles: roles ?? [] },
        },
        request,
      );
      await app.audit.activity({
        userId: request.user?.id ?? created.id,
        action: "user_created",
        entityType: "user",
        entityId: created.id,
        metadata: { email },
      });
      reply.code(201);
      return { user: serializeUser(user) };
    },
  });

  typed.patch("/api/users/:id", {
    schema: {
      params: userIdParamsSchema,
      body: updateUserBodySchema,
      response: { 200: userResponseSchema },
    },
    preHandler: [guard, requireCsrf],
    handler: async (request) => {
      const { email, password, displayName, isActive } = request.body;
      const data: Record<string, string | boolean> = {};
      const changes: Record<string, string | boolean> = {};
      if (email !== undefined) {
        data.email = email;
        changes.email = email;
      }
      if (password !== undefined) {
        data.passwordHash = await app.auth.hashPassword(password);
        changes.passwordChanged = true;
      }
      if (displayName !== undefined) {
        data.displayName = displayName;
        changes.displayName = displayName;
      }
      if (isActive !== undefined) {
        data.isActive = isActive;
        changes.isActive = isActive;
      }
      const updated = await app.db.users.update(request.params.id, data);
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }
      if (changes.passwordChanged) {
        await app.db.sessions.revokeAllForUser(updated.id);
        await app.audit.audit(
          {
            ...(request.user ? { userId: request.user.id } : {}),
            action: "password_changed",
            entityType: "user",
            entityId: updated.id,
            success: true,
          },
          request,
        );
      }
      await app.audit.audit(
        {
          ...(request.user ? { userId: request.user.id } : {}),
          action: "user_updated",
          entityType: "user",
          entityId: updated.id,
          metadata: changes,
        },
        request,
      );
      const user = await app.db.users.findById(updated.id);
      if (!user) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }
      return { user: serializeUser(user) };
    },
  });

  typed.delete("/api/users/:id", {
    schema: {
      params: userIdParamsSchema,
    },
    preHandler: [guard, requireCsrf],
    handler: async (request, reply) => {
      const target = await app.db.users.findById(request.params.id);
      const deleted = await app.db.users.delete(request.params.id);
      if (!deleted) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }
      await app.audit.audit(
        {
          ...(request.user ? { userId: request.user.id } : {}),
          action: "user_deleted",
          entityType: "user",
          entityId: request.params.id,
          metadata: { email: target?.email ?? null },
        },
        request,
      );
      reply.code(204).send();
    },
  });

  typed.put("/api/users/:id/roles", {
    schema: {
      params: userIdParamsSchema,
      body: setRolesBodySchema,
      response: { 200: userResponseSchema },
    },
    preHandler: [guard, requireCsrf],
    handler: async (request) => {
      const user = await app.db.users.findById(request.params.id);
      if (!user) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }
      const existingRoles = await app.db.roles.listByCodes(request.body.roleCodes);
      const knownCodes = new Set(existingRoles.map((role) => role.code));
      const missingCodes = request.body.roleCodes.filter((code) => !knownCodes.has(code));
      if (missingCodes.length > 0) {
        throw new AppError(400, "INVALID_ROLES", `Unknown role codes: ${missingCodes.join(", ")}`);
      }
      const previousRoles = user.roles.map((userRole) => userRole.role.code);
      await app.db.users.setRoles(user.id, request.body.roleCodes);
      await app.audit.audit(
        {
          ...(request.user ? { userId: request.user.id } : {}),
          action: "user_roles_changed",
          entityType: "user",
          entityId: user.id,
          metadata: { previousRoles, newRoles: request.body.roleCodes },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        action: "roles_updated",
        entityType: "user",
        entityId: user.id,
        metadata: { previousRoles, newRoles: request.body.roleCodes },
      });
      const updated = await app.db.users.findById(user.id);
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }
      return { user: serializeUser(updated) };
    },
  });
}

function serializeUser(user: UserWithRoles) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    roles: user.roles.map((userRole) => ({
      id: userRole.role.id,
      code: userRole.role.code,
      description: userRole.role.description,
    })),
  };
}
