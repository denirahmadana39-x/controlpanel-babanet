import { statfsSync } from "node:fs";
import { hostname, arch, platform, cpus, loadavg, totalmem, freemem } from "node:os";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requirePermissions } from "../auth/guards.js";
import { PERMISSION_CODES } from "@hosting/shared";

const STALE_WORKER_MINUTES = 10;

const guard = requirePermissions([PERMISSION_CODES.MONITORING_VIEW]);

const systemResponseSchema = z.object({
  status: z.literal("ok"),
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  nodeVersion: z.string(),
  uptimeSeconds: z.number(),
  cpu: z.object({
    cores: z.number(),
    loadAvg: z.tuple([z.number(), z.number(), z.number()]),
  }),
  memory: z.object({
    totalBytes: z.number(),
    freeBytes: z.number(),
    usedBytes: z.number(),
    usagePercent: z.number(),
  }),
  disk: z.object({
    path: z.string(),
    totalBytes: z.number(),
    freeBytes: z.number(),
    usedBytes: z.number(),
    usagePercent: z.number(),
  }),
});

const storageResponseSchema = z.object({
  totalQuotaMb: z.number(),
  totalUsedMb: z.number(),
  usagePercent: z.number(),
  projects: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      ownerId: z.string(),
      ownerEmail: z.string(),
      usedMb: z.number(),
      quotaMb: z.number(),
      usagePercent: z.number(),
    }),
  ),
  backups: z.object({
    count: z.number(),
    totalSizeMb: z.number(),
  }),
});

const metricsResponseSchema = z.object({
  process: z.object({
    pid: z.number(),
    uptimeSeconds: z.number(),
    nodeVersion: z.string(),
  }),
  workers: z.object({
    active: z.number(),
  }),
  gauges: z.record(z.string(), z.number()),
  counters: z.record(z.string(), z.number()),
  histograms: z.record(
    z.string(),
    z.object({
      count: z.number(),
      sum: z.number(),
      min: z.number(),
      max: z.number(),
      buckets: z.record(z.string(), z.number()),
    }),
  ),
  recordedAt: z.string(),
});

export async function registerMonitoringRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get("/api/system", {
    schema: {
      response: { 200: systemResponseSchema },
    },
    preHandler: guard,
    handler: async () => {
      const disk = statfsSync(process.cwd());
      const diskTotalBytes = disk.bsize * disk.blocks;
      const diskFreeBytes = disk.bsize * disk.bavail;
      const diskUsedBytes = diskTotalBytes - diskFreeBytes;

      const memoryTotalBytes = totalmem();
      const memoryFreeBytes = freemem();
      const memoryUsedBytes = memoryTotalBytes - memoryFreeBytes;

      return {
        status: "ok" as const,
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        nodeVersion: process.version,
        uptimeSeconds: process.uptime(),
        cpu: {
          cores: cpus().length,
          loadAvg: [loadavg()[0] ?? 0, loadavg()[1] ?? 0, loadavg()[2] ?? 0] as [
            number,
            number,
            number,
          ],
        },
        memory: {
          totalBytes: memoryTotalBytes,
          freeBytes: memoryFreeBytes,
          usedBytes: memoryUsedBytes,
          usagePercent: percent(memoryUsedBytes, memoryTotalBytes),
        },
        disk: {
          path: process.cwd(),
          totalBytes: diskTotalBytes,
          freeBytes: diskFreeBytes,
          usedBytes: diskUsedBytes,
          usagePercent: percent(diskUsedBytes, diskTotalBytes),
        },
      };
    },
  });

  typed.get("/api/storage", {
    schema: {
      response: { 200: storageResponseSchema },
    },
    preHandler: guard,
    handler: async () => {
      const usages = await app.db.storageUsage.listAllWithProjects();
      const totalQuotaMb = usages.reduce((sum, usage) => sum + usage.quotaMb, 0);
      const totalUsedMb = usages.reduce((sum, usage) => sum + usage.usedMb, 0);
      const backupCount = await app.db.backups.count();
      const backupSizeMb = await app.db.backups.sumSizeMb();

      return {
        totalQuotaMb,
        totalUsedMb,
        usagePercent: percent(totalUsedMb, totalQuotaMb),
        projects: usages.map((usage) => ({
          projectId: usage.projectId,
          projectName: usage.project.name,
          ownerId: usage.project.ownerId,
          ownerEmail: usage.project.owner.email,
          usedMb: usage.usedMb,
          quotaMb: usage.quotaMb,
          usagePercent: percent(usage.usedMb, usage.quotaMb),
        })),
        backups: {
          count: backupCount,
          totalSizeMb: backupSizeMb,
        },
      };
    },
  });

  typed.get("/api/metrics", {
    schema: {
      response: { 200: metricsResponseSchema },
    },
    preHandler: guard,
    handler: async () => {
      const [deploymentStatusCounts, activeWorkers, usersCount, projectsCount, usages] =
        await Promise.all([
          app.db.deployments.countByStatus(),
          app.db.workers.countActive(STALE_WORKER_MINUTES),
          app.db.users.count(),
          app.db.projects.countAll(),
          app.db.storageUsage.listAllWithProjects(),
        ]);

      const deploymentCounts: Record<string, number> = {};
      for (const entry of deploymentStatusCounts) {
        deploymentCounts[entry.status] = entry.count;
      }

      const snapshot = app.metrics.snapshot();
      return {
        process: {
          pid: process.pid,
          uptimeSeconds: process.uptime(),
          nodeVersion: process.version,
        },
        workers: {
          active: activeWorkers,
        },
        gauges: {
          users: usersCount,
          projects: projectsCount,
          deploymentsQueued: deploymentCounts.QUEUED ?? 0,
          deploymentsRunning: deploymentCounts.RUNNING ?? 0,
          deploymentsSucceeded: deploymentCounts.SUCCEEDED ?? 0,
          deploymentsFailed: deploymentCounts.FAILED ?? 0,
          totalStorageUsedMb: usages.reduce((sum, usage) => sum + usage.usedMb, 0),
          totalStorageQuotaMb: usages.reduce((sum, usage) => sum + usage.quotaMb, 0),
        },
        counters: snapshot.counters,
        histograms: snapshot.histograms,
        recordedAt: snapshot.recordedAt,
      };
    },
  });
}

function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((used / total) * 1000) / 10;
}
