import type { Domain } from "@hosting/database";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { PERMISSION_CODES } from "@hosting/shared";
import { AppError } from "../../errors/app-error.js";
import { assertUser, requireCsrf, requirePermissions } from "../auth/guards.js";
import { assertProjectAccess } from "../projects/access.js";

const projectIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const domainIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const projectAndDomainParamsSchema = z.object({
  id: z.string().uuid(),
  domainId: z.string().uuid(),
});

const hostnameSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/, {
    message: "Invalid hostname",
  })
  .transform((value) => value.toLowerCase());

const createDomainBodySchema = z.object({
  hostname: hostnameSchema,
  isPrimary: z.boolean().optional(),
});

const setPrimaryBodySchema = z.object({
  isPrimary: z.literal(true),
});

const domainSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  hostname: z.string(),
  isPrimary: z.boolean(),
  status: z.enum(["PENDING", "VERIFIED", "FAILED"]),
  sslEnabled: z.boolean(),
  sslStatus: z.enum(["NONE", "PENDING", "ACTIVE", "FAILED"]),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const domainListResponseSchema = z.object({
  domains: z.array(domainSchema),
});

const domainResponseSchema = z.object({
  domain: domainSchema,
});

export async function registerDomainsRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get("/api/projects/:id/domains", {
    schema: {
      params: projectIdParamsSchema,
      response: { 200: domainListResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.DOMAINS_MANAGE]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);
      const domains = await app.db.domains.listByProject(project.id);
      return { domains: domains.map(serializeDomain) };
    },
  });

  typed.post("/api/projects/:id/domains", {
    schema: {
      params: projectIdParamsSchema,
      body: createDomainBodySchema,
      response: { 201: domainResponseSchema },
    },
    preHandler: [requirePermissions([PERMISSION_CODES.DOMAINS_MANAGE]), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);

      const hostname = request.body.hostname;
      const existing = await app.db.domains.findByHostname(hostname);
      if (existing) {
        throw new AppError(409, "CONFLICT", "That hostname is already in use");
      }

      const domain = await app.db.domains.create({
        projectId: project.id,
        hostname,
        ...(request.body.isPrimary !== undefined ? { isPrimary: request.body.isPrimary } : {}),
      });
      const isManaged =
        hostname === app.siteConfig.config.baseDomain ||
        hostname.endsWith(`.${app.siteConfig.config.baseDomain}`);
      if (isManaged) {
        await app.db.domains.setVerified(domain.id);
      }

      await app.siteConfig.syncSiteConfig(project.id, project.name);

      await app.audit.audit(
        {
          userId: user.id,
          action: "domain_created",
          entityType: "domain",
          entityId: domain.id,
          metadata: { projectId: project.id, hostname },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        projectId: project.id,
        action: "domain_created",
        entityType: "domain",
        entityId: domain.id,
        metadata: { hostname },
      });

      const refreshed = await app.db.domains.findById(domain.id);
      reply.code(201);
      return { domain: serializeDomain(refreshed ?? domain) };
    },
  });

  typed.patch("/api/projects/:id/domains/:domainId", {
    schema: {
      params: projectAndDomainParamsSchema,
      body: setPrimaryBodySchema,
      response: { 200: domainResponseSchema },
    },
    preHandler: [requirePermissions([PERMISSION_CODES.DOMAINS_MANAGE]), requireCsrf],
    handler: async (request) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);
      const updated = await app.db.domains.setPrimary(project.id, request.params.domainId);
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Domain not found");
      }
      return { domain: serializeDomain(updated) };
    },
  });

  typed.delete("/api/domains/:id", {
    schema: {
      params: domainIdParamsSchema,
    },
    preHandler: [requirePermissions([PERMISSION_CODES.DOMAINS_MANAGE]), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const domain = await app.db.domains.findById(request.params.id);
      if (!domain) {
        throw new AppError(404, "NOT_FOUND", "Domain not found");
      }
      const project = await app.db.projects.findById(domain.projectId);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);

      const deleted = await app.db.domains.delete(domain.id);
      if (!deleted) {
        throw new AppError(404, "NOT_FOUND", "Domain not found");
      }
      await app.siteConfig.syncSiteConfig(project.id, project.name);

      await app.audit.audit(
        {
          userId: user.id,
          action: "domain_deleted",
          entityType: "domain",
          entityId: domain.id,
          metadata: { projectId: project.id, hostname: domain.hostname },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        projectId: project.id,
        action: "domain_deleted",
        entityType: "domain",
        entityId: domain.id,
        metadata: { hostname: domain.hostname },
      });
      reply.code(204).send();
    },
  });
}

function serializeDomain(domain: Domain) {
  return {
    id: domain.id,
    projectId: domain.projectId,
    hostname: domain.hostname,
    isPrimary: domain.isPrimary,
    status: domain.status,
    sslEnabled: domain.sslEnabled,
    sslStatus: domain.sslStatus,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    createdAt: domain.createdAt.toISOString(),
    updatedAt: domain.updatedAt.toISOString(),
  };
}
