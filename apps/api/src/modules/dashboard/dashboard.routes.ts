import { PERMISSION_CODES, ROLE_CODES } from "@hosting/shared";
import type { Deployment } from "@hosting/database";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { assertUser, requirePermissions } from "../auth/guards.js";

const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED"]),
  url: z.string(),
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

const deploymentSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  version: z.number(),
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "ROLLED_BACK"]),
  createdAt: z.string(),
});

const activitySummarySchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
});

const clientDashboardResponseSchema = z.object({
  stats: z.object({
    projectsCount: z.number(),
    totalStorageUsedMb: z.number(),
    totalStorageQuotaMb: z.number(),
  }),
  projects: z.array(projectSummarySchema),
  recentDeployments: z.array(deploymentSummarySchema),
  recentActivity: z.array(activitySummarySchema),
});

const adminDashboardResponseSchema = z.object({
  stats: z.object({
    usersCount: z.number(),
    projectsCount: z.number(),
    activeProjects: z.number(),
    suspendedProjects: z.number(),
    deploymentsCount: z.number(),
    totalStorageUsedMb: z.number(),
    totalStorageQuotaMb: z.number(),
    backupCount: z.number(),
    backupSizeMb: z.number(),
  }),
  deploymentStatusCounts: z.array(
    z.object({
      status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "ROLLED_BACK"]),
      count: z.number(),
    }),
  ),
  recentDeployments: z.array(deploymentSummarySchema),
  recentActivity: z.array(activitySummarySchema),
  recentUsers: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      displayName: z.string(),
      isActive: z.boolean(),
      createdAt: z.string(),
    }),
  ),
});

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get("/api/dashboard", {
    schema: {
      response: { 200: clientDashboardResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.PROJECTS_VIEW]),
    handler: async (request) => {
      const user = assertUser(request.user);
      const projects = await app.db.projects.listByOwner(user.id);

      const projectIds = projects.map((project) => project.id);
      const [activeDeployments, latestDeployments, domainCounts, fileCounts, usages] =
        await Promise.all([
          app.db.deployments.findActiveByProjects(projectIds),
          app.db.deployments.latestByProjects(projectIds),
          app.db.domains.countByProjects(projectIds),
          app.db.files.countByProjects(projectIds),
          app.db.storageUsage.findByProjects(projectIds),
        ]);

      const activeByProject = new Map(
        activeDeployments.map((deployment) => [deployment.projectId, deployment]),
      );
      const latestByProject = new Map<string, Deployment>();
      for (const deployment of latestDeployments) {
        if (!latestByProject.has(deployment.projectId)) {
          latestByProject.set(deployment.projectId, deployment);
        }
      }
      const usageByProject = new Map(usages.map((usage) => [usage.projectId, usage]));

      const summaries = await Promise.all(
        projects.map(async (project) => {
          const active = activeByProject.get(project.id) ?? null;
          const latest = latestByProject.get(project.id) ?? null;
          const primaryHostname = await app.siteConfig.primaryHostname(project.id, project.name);
          return {
            id: project.id,
            name: project.name,
            status: project.status,
            url: `http://${primaryHostname}`,
            activeVersion: active?.version ?? null,
            lastDeploymentStatus: latest?.status ?? null,
            lastDeployedAt: latest?.completedAt?.toISOString() ?? null,
            domainCount: domainCounts.get(project.id) ?? 0,
            fileCount: fileCounts.get(project.id) ?? 0,
            storageUsedMb: usageByProject.get(project.id)?.usedMb ?? 0,
            storageQuotaMb: usageByProject.get(project.id)?.quotaMb ?? project.storageQuotaMb,
          };
        }),
      );

      const recentDeployments = await app.db.deployments.listRecent(10);
      const recentActivity = await app.db.activityLogs.listByUser(user.id, 10);

      return {
        stats: {
          projectsCount: projects.length,
          totalStorageUsedMb: summaries.reduce((sum, project) => sum + project.storageUsedMb, 0),
          totalStorageQuotaMb: summaries.reduce((sum, project) => sum + project.storageQuotaMb, 0),
        },
        projects: summaries,
        recentDeployments: recentDeployments
          .filter(
            (deployment) =>
              deployment.project.ownerId === user.id || user.roles.includes(ROLE_CODES.admin),
          )
          .map(serializeDeploymentSummary),
        recentActivity: recentActivity.map(serializeActivitySummary),
      };
    },
  });

  typed.get("/api/admin/dashboard", {
    schema: {
      response: { 200: adminDashboardResponseSchema },
    },
    preHandler: requirePermissions([PERMISSION_CODES.MONITORING_VIEW]),
    handler: async () => {
      const [
        usersCount,
        projectsCount,
        projectStatuses,
        deploymentStatusCounts,
        recentDeployments,
        recentActivity,
        recentUsers,
        usages,
        backups,
        backupSizeMb,
      ] = await Promise.all([
        app.db.users.count(),
        app.db.projects.countAll(),
        app.db.projects.countByStatus(),
        app.db.deployments.countByStatus(),
        app.db.deployments.listRecent(10),
        app.db.activityLogs.listRecent(10),
        app.db.users.list().then((users) => users.slice(0, 10)),
        app.db.storageUsage.listAllWithProjects(),
        app.db.backups.count(),
        app.db.backups.sumSizeMb(),
      ]);

      return {
        stats: {
          usersCount,
          projectsCount,
          activeProjects: projectStatuses.find((entry) => entry.status === "ACTIVE")?.count ?? 0,
          suspendedProjects:
            projectStatuses.find((entry) => entry.status === "SUSPENDED")?.count ?? 0,
          deploymentsCount: deploymentStatusCounts.reduce((sum, entry) => sum + entry.count, 0),
          totalStorageUsedMb: usages.reduce((sum, usage) => sum + usage.usedMb, 0),
          totalStorageQuotaMb: usages.reduce((sum, usage) => sum + usage.quotaMb, 0),
          backupCount: backups,
          backupSizeMb,
        },
        deploymentStatusCounts,
        recentDeployments: recentDeployments.map(serializeDeploymentSummary),
        recentActivity: recentActivity.map(serializeActivitySummary),
        recentUsers: recentUsers.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          isActive: user.isActive,
          createdAt: user.createdAt.toISOString(),
        })),
      };
    },
  });
}

function serializeDeploymentSummary(
  deployment: Pick<Deployment, "id" | "projectId" | "version" | "status" | "createdAt"> & {
    project: { name: string };
  },
) {
  return {
    id: deployment.id,
    projectId: deployment.projectId,
    projectName: deployment.project.name,
    version: deployment.version,
    status: deployment.status,
    createdAt: deployment.createdAt.toISOString(),
  };
}

function serializeActivitySummary(activity: {
  id: string;
  projectId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    id: activity.id,
    projectId: activity.projectId,
    action: activity.action,
    entityType: activity.entityType,
    entityId: activity.entityId,
    metadata: activity.metadata ?? null,
    createdAt: activity.createdAt.toISOString(),
  };
}
