import { PERMISSION_CODES, ROLE_CODES } from "@hosting/shared";
import type { ProjectWithOwner } from "@hosting/database";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { assertUser, requireCsrf, requirePermissions } from "../auth/guards.js";
import { assertProjectAccess } from "./access.js";

const projectNameSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: "Project name must be lowercase alphanumeric and hyphens only",
  });

const storageQuotaMbSchema = z.number().int().min(1).max(1_048_576).optional();

const projectIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const createProjectBodySchema = z.object({
  name: projectNameSchema,
  description: z.string().max(500).optional(),
  storageQuotaMb: storageQuotaMbSchema,
});

const updateProjectBodySchema = z.object({
  name: projectNameSchema.optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED"]).optional(),
  storageQuotaMb: storageQuotaMbSchema,
});

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED"]),
  storageQuotaMb: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  owner: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
  }),
});

const listProjectsResponseSchema = z.object({
  projects: z.array(projectSchema),
});

const projectResponseSchema = z.object({
  project: projectSchema,
});

export async function registerProjectsRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get("/api/projects", {
    schema: {
      response: { 200: listProjectsResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.PROJECTS_VIEW]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const isAdmin = user.roles.includes(ROLE_CODES.admin);
      const projects = isAdmin
        ? await app.db.projects.listAll()
        : await app.db.projects.listByOwner(user.id);
      return { projects: projects.map(serializeProject) };
    },
  });

  typed.get("/api/projects/:id", {
    schema: {
      params: projectIdParamsSchema,
      response: { 200: projectResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.PROJECTS_VIEW]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);
      return { project: serializeProject(project) };
    },
  });

  typed.post("/api/projects", {
    schema: {
      body: createProjectBodySchema,
      response: { 201: projectResponseSchema },
    },
    preHandler: [requirePermissions([PERMISSION_CODES.PROJECTS_CREATE]), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const { name, description, storageQuotaMb } = request.body;
      const quotaMb = storageQuotaMb ?? 100;
      const created = await app.db.projects.create({
        name,
        ...(description !== undefined ? { description } : {}),
        ownerId: user.id,
        storageQuotaMb: quotaMb,
      });
      await app.db.storageUsage.create(created.id, quotaMb);
      await app.audit.audit(
        {
          userId: user.id,
          action: "project_created",
          entityType: "project",
          entityId: created.id,
          metadata: { name },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        projectId: created.id,
        action: "project_created",
        entityType: "project",
        entityId: created.id,
        metadata: { name },
      });
      const project = await app.db.projects.findById(created.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      reply.code(201);
      return { project: serializeProject(project) };
    },
  });

  typed.patch("/api/projects/:id", {
    schema: {
      params: projectIdParamsSchema,
      body: updateProjectBodySchema,
      response: { 200: projectResponseSchema },
    },
    preHandler: [requirePermissions([PERMISSION_CODES.PROJECTS_UPDATE]), requireCsrf],
    handler: async (request) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);
      if (request.body.status !== undefined && !user.roles.includes(ROLE_CODES.admin)) {
        throw new AppError(403, "FORBIDDEN", "Only administrators can change project status");
      }
      const data: Record<string, string | number> = {};
      if (request.body.name !== undefined) data.name = request.body.name;
      if (request.body.description !== undefined) data.description = request.body.description;
      if (request.body.status !== undefined) data.status = request.body.status;
      if (request.body.storageQuotaMb !== undefined)
        data.storageQuotaMb = request.body.storageQuotaMb;
      const updated = await app.db.projects.update(project.id, data);
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      await app.audit.audit(
        {
          userId: user.id,
          action: "project_updated",
          entityType: "project",
          entityId: project.id,
          metadata: data,
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        projectId: project.id,
        action: "project_updated",
        entityType: "project",
        entityId: project.id,
        metadata: data,
      });
      const refreshed = await app.db.projects.findById(project.id);
      if (!refreshed) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      return { project: serializeProject(refreshed) };
    },
  });

  typed.delete("/api/projects/:id", {
    schema: {
      params: projectIdParamsSchema,
    },
    preHandler: [requirePermissions([PERMISSION_CODES.PROJECTS_DELETE]), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);
      const deleted = await app.db.projects.delete(project.id);
      if (!deleted) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      app.storage.removeProjectStorage(project.id);
      await app.siteConfig.removeSiteConfig(project.id);
      await app.audit.audit(
        {
          userId: user.id,
          action: "project_deleted",
          entityType: "project",
          entityId: project.id,
          metadata: { name: project.name },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        action: "project_deleted",
        entityType: "project",
        entityId: project.id,
        metadata: { name: project.name },
      });
      reply.code(204).send();
    },
  });
}

function serializeProject(project: ProjectWithOwner) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    storageQuotaMb: project.storageQuotaMb,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    owner: project.owner,
  };
}
