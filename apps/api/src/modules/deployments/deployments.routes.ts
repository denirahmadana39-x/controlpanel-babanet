import { closeSync, openSync, readSync } from "node:fs";
import type { Deployment, DeploymentHistory } from "@hosting/database";
import type { MultipartFile } from "@fastify/multipart";
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

const deploymentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const rollbackBodySchema = z.object({
  version: z.number().int().positive(),
});

const deploymentSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "ROLLED_BACK"]),
  trigger: z.enum(["MANUAL", "AUTOMATIC"]),
  active: z.boolean(),
  url: z.string().nullable(),
  sizeMb: z.number().nullable(),
  error: z.string().nullable(),
  rollbackOfVersion: z.number().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

const uploadResponseSchema = z.object({
  deployment: deploymentSchema,
  filename: z.string(),
  sizeBytes: z.number(),
});

const deploymentListResponseSchema = z.object({
  deployments: z.array(deploymentSchema),
  history: z.array(
    z.object({
      id: z.string(),
      url: z.string().nullable(),
      sizeMb: z.number().nullable(),
      status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "ROLLED_BACK"]),
      deployedAt: z.string(),
      metadata: z.unknown().nullable(),
    }),
  ),
});

const deploymentResponseSchema = z.object({
  deployment: deploymentSchema,
});

const siteInfoResponseSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  url: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED"]),
  activeVersion: z.number().nullable(),
  lastDeploymentStatus: z
    .enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "ROLLED_BACK"])
    .nullable(),
  lastDeployedAt: z.string().nullable(),
  domainCount: z.number(),
  fileCount: z.number(),
  storageUsedMb: z.number(),
  storageQuotaMb: z.number(),
});

export async function registerDeploymentsRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post("/api/projects/:id/upload", {
    schema: {
      params: projectIdParamsSchema,
      response: { 201: uploadResponseSchema },
    },
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    preHandler: [requirePermissions([PERMISSION_CODES.PROJECTS_DEPLOY]), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);

      const file: MultipartFile | undefined = await request.file();
      if (!file) {
        throw new AppError(400, "VALIDATION_ERROR", "A zip archive file is required");
      }
      const filename = file.filename ?? "archive.zip";
      if (!/\.zip$/i.test(filename) && !isZipMimeType(file.mimetype)) {
        throw new AppError(400, "VALIDATION_ERROR", "Only .zip archives can be uploaded");
      }

      const saved = await app.storage.saveUpload(project.id, filename, file.file);
      if (!isZipArchive(saved.path)) {
        app.storage.deletePath(saved.path);
        throw new AppError(400, "VALIDATION_ERROR", "Uploaded file is not a valid zip archive");
      }

      const sizeMb = Math.max(1, Math.ceil(saved.sizeBytes / (1024 * 1024)));
      const usage = await app.db.storageUsage.findByProject(project.id);
      const quotaMb = usage?.quotaMb ?? project.storageQuotaMb;
      if (usage !== null && usage.usedMb + sizeMb > quotaMb) {
        app.storage.deletePath(saved.path);
        throw new AppError(413, "QUOTA_EXCEEDED", "Upload would exceed the project storage quota");
      }

      const deployment = await app.db.deployments.createWithNextVersion({
        projectId: project.id,
        trigger: "AUTOMATIC",
        uploadPath: saved.path,
      });
      const version = deployment.version;

      await app.audit.audit(
        {
          userId: user.id,
          action: "deployment_uploaded",
          entityType: "deployment",
          entityId: deployment.id,
          metadata: { projectId: project.id, version, sizeMb, filename },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        projectId: project.id,
        action: "deployment_uploaded",
        entityType: "deployment",
        entityId: deployment.id,
        metadata: { version, sizeMb, filename },
      });

      reply.code(201);
      return { deployment: serializeDeployment(deployment), filename, sizeBytes: saved.sizeBytes };
    },
  });

  typed.get("/api/projects/:id/deployments", {
    schema: {
      params: projectIdParamsSchema,
      response: { 200: deploymentListResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.PROJECTS_VIEW]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);
      const [deployments, history] = await Promise.all([
        app.db.deployments.listByProject(project.id),
        app.db.deploymentHistory.listByProject(project.id),
      ]);
      return {
        deployments: deployments.map(serializeDeployment),
        history: history.map(serializeHistory),
      };
    },
  });

  typed.get("/api/deployments/:id", {
    schema: {
      params: deploymentIdParamsSchema,
      response: { 200: deploymentResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.PROJECTS_VIEW]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const deployment = await app.db.deployments.findById(request.params.id);
      if (!deployment) {
        throw new AppError(404, "NOT_FOUND", "Deployment not found");
      }
      assertProjectAccess(user, deployment.project);
      return { deployment: serializeDeployment(deployment) };
    },
  });

  typed.post("/api/projects/:id/rollback", {
    schema: {
      params: projectIdParamsSchema,
      body: rollbackBodySchema,
      response: { 201: deploymentResponseSchema },
    },
    preHandler: [requirePermissions([PERMISSION_CODES.PROJECTS_ROLLBACK]), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);

      const target = await app.db.deployments.findSucceededByVersion(
        project.id,
        request.body.version,
      );
      if (!target) {
        throw new AppError(404, "NOT_FOUND", "No succeeded deployment exists for that version");
      }
      const active = await app.db.deployments.findActiveByProject(project.id);
      if (active && active.version === target.version) {
        throw new AppError(400, "VALIDATION_ERROR", "That version is already live");
      }

      const deployment = await app.db.deployments.createWithNextVersion({
        projectId: project.id,
        trigger: "MANUAL",
        rollbackOfVersion: target.version,
      });

      await app.audit.audit(
        {
          userId: user.id,
          action: "deployment_rollback_requested",
          entityType: "deployment",
          entityId: deployment.id,
          metadata: { projectId: project.id, targetVersion: target.version },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        projectId: project.id,
        action: "deployment_rollback_requested",
        entityType: "deployment",
        entityId: deployment.id,
        metadata: { targetVersion: target.version },
      });

      reply.code(201);
      return { deployment: serializeDeployment(deployment) };
    },
  });

  typed.get("/api/projects/:id/site", {
    schema: {
      params: projectIdParamsSchema,
      response: { 200: siteInfoResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.PROJECTS_VIEW]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);

      const [active, deployments, domainCount, fileCount, usage] = await Promise.all([
        app.db.deployments.findActiveByProject(project.id),
        app.db.deployments.listByProject(project.id),
        app.db.domains.countByProject(project.id),
        app.db.files.countByProject(project.id),
        app.db.storageUsage.findByProject(project.id),
      ]);
      const primaryHostname = await app.siteConfig.primaryHostname(project.id, project.name);
      const latest = deployments[0];
      return {
        projectId: project.id,
        name: project.name,
        url: `http://${primaryHostname}`,
        status: project.status,
        activeVersion: active?.version ?? null,
        lastDeploymentStatus: latest?.status ?? null,
        lastDeployedAt: latest?.completedAt?.toISOString() ?? null,
        domainCount,
        fileCount,
        storageUsedMb: usage?.usedMb ?? 0,
        storageQuotaMb: usage?.quotaMb ?? project.storageQuotaMb,
      };
    },
  });
}

function isZipMimeType(mimetype: string): boolean {
  return ["application/zip", "application/x-zip-compressed", "application/octet-stream"].includes(
    mimetype,
  );
}

function isZipArchive(path: string): boolean {
  try {
    const handle = openSync(path, "r");
    try {
      const header = Buffer.allocUnsafe(4);
      if (readSync(handle, header, 0, 4, 0) < 4) return false;
      return header[0] === 0x50 && header[1] === 0x4b;
    } finally {
      closeSync(handle);
    }
  } catch {
    return false;
  }
}

function serializeDeployment(deployment: Deployment) {
  return {
    id: deployment.id,
    version: deployment.version,
    status: deployment.status,
    trigger: deployment.trigger,
    active: deployment.active,
    url: deployment.url,
    sizeMb: deployment.sizeMb,
    error: deployment.error,
    rollbackOfVersion: deployment.rollbackOfVersion,
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.startedAt?.toISOString() ?? null,
    completedAt: deployment.completedAt?.toISOString() ?? null,
  };
}

function serializeHistory(history: DeploymentHistory) {
  return {
    id: history.id,
    url: history.url,
    sizeMb: history.sizeMb,
    status: history.status,
    deployedAt: history.deployedAt.toISOString(),
    metadata: history.metadata ?? null,
  };
}
