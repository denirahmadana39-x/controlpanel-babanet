import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { assertUser, requireCsrf, requirePermissions } from "../auth/guards.js";
import { assertProjectAccess } from "../projects/access.js";
import { PERMISSION_CODES } from "@hosting/shared";

const projectIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const fileEntrySchema = z.object({
  path: z.string(),
  type: z.enum(["file", "directory"]),
  sizeBytes: z.number(),
  mimeType: z.string().nullable(),
  checksumSha256: z.string().nullable(),
});

const listFilesResponseSchema = z.object({
  files: z.array(fileEntrySchema),
});

const listFilesQuerySchema = z.object({
  path: z.string().optional(),
});

const deleteFilesQuerySchema = z.object({
  path: z.string().min(1),
});

export async function registerFilesRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get("/api/projects/:id/files", {
    schema: {
      params: projectIdParamsSchema,
      querystring: listFilesQuerySchema,
      response: { 200: listFilesResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.FILES_MANAGE]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);

      const liveDir = app.storage.projectLiveDir(project.id);
      if (!existsSync(liveDir)) {
        return { files: [] };
      }

      const checksums = new Map(
        (await app.db.files.listByProject(project.id)).map((file) => [
          file.path,
          file.checksumSha256,
        ]),
      );
      const prefix = request.query.path ?? "";
      const entries = app.storage
        .listTree(liveDir)
        .filter(
          (entry) =>
            prefix.length === 0 || entry.path === prefix || entry.path.startsWith(`${prefix}/`),
        )
        .map((entry) => ({
          ...entry,
          checksumSha256: checksums.get(entry.path) ?? null,
        }));
      return { files: entries };
    },
  });

  typed.delete("/api/projects/:id/files", {
    schema: {
      params: projectIdParamsSchema,
      querystring: deleteFilesQuerySchema,
    },
    preHandler: [requirePermissions([PERMISSION_CODES.FILES_MANAGE]), requireCsrf],
    handler: async (request, reply) => {
      const user = assertUser(request.user);
      const project = await app.db.projects.findById(request.params.id);
      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      assertProjectAccess(user, project);

      const liveDir = app.storage.projectLiveDir(project.id);
      if (!existsSync(liveDir)) {
        throw new AppError(404, "NOT_FOUND", "Project has no deployed files");
      }
      const relativePath = request.query.path;
      const removed = app.storage.deleteTree(liveDir, relativePath);
      if (!removed) {
        throw new AppError(404, "NOT_FOUND", "File or directory not found");
      }

      await app.db.files.deleteByPathPrefix(project.id, relativePath);
      const usedMb = Math.max(0, Math.ceil(app.storage.computeSizeBytes(liveDir) / (1024 * 1024)));
      await app.db.storageUsage.setUsed(project.id, usedMb);

      await app.audit.audit(
        {
          userId: user.id,
          action: "file_deleted",
          entityType: "file",
          metadata: { projectId: project.id, path: relativePath },
        },
        request,
      );
      await app.audit.activity({
        userId: user.id,
        projectId: project.id,
        action: "file_deleted",
        entityType: "file",
        metadata: { path: relativePath },
      });
      reply.code(204).send();
    },
  });
}
