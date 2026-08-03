import type {
  Prisma,
  PrismaClient,
  Deployment,
  DeploymentTrigger,
} from "../../generated/client/client.js";
import { projectLockKeyPair } from "../project-lock.js";

export type DeploymentWithProject = Prisma.DeploymentGetPayload<{
  include: {
    project: { include: { owner: { select: { id: true; email: true; displayName: true } } } };
  };
}>;

export interface CreateDeploymentInput {
  projectId: string;
  version: number;
  trigger?: DeploymentTrigger;
  rollbackOfVersion?: number;
  uploadPath?: string;
}

export interface RecoverOrphansResult {
  requeued: number;
  failed: number;
}

export class DeploymentRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateDeploymentInput): Promise<Deployment> {
    return this.client.deployment.create({
      data: {
        projectId: input.projectId,
        version: input.version,
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.rollbackOfVersion !== undefined
          ? { rollbackOfVersion: input.rollbackOfVersion }
          : {}),
        ...(input.uploadPath !== undefined ? { uploadPath: input.uploadPath } : {}),
      },
    });
  }

  /**
   * Atomically allocates the next version for a project and creates the deployment.
   * A Postgres advisory xact lock on the project prevents two concurrent uploads
   * from racing on `max(version) + 1`. The unique `[projectId, version]` constraint
   * remains as a final safety net.
   */
  async createWithNextVersion(input: Omit<CreateDeploymentInput, "version">): Promise<Deployment> {
    const lockKey = projectLockKeyPair(input.projectId);
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey.a}, ${lockKey.b})::text AS "locked"`;
      const aggregate = await tx.deployment.aggregate({
        where: { projectId: input.projectId },
        _max: { version: true },
      });
      const version = (aggregate._max.version ?? 0) + 1;
      return tx.deployment.create({
        data: {
          projectId: input.projectId,
          version,
          ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
          ...(input.rollbackOfVersion !== undefined
            ? { rollbackOfVersion: input.rollbackOfVersion }
            : {}),
          ...(input.uploadPath !== undefined ? { uploadPath: input.uploadPath } : {}),
        },
      });
    });
  }

  async findById(id: string): Promise<DeploymentWithProject | null> {
    return this.client.deployment.findUnique({
      where: { id },
      include: {
        project: { include: { owner: { select: { id: true, email: true, displayName: true } } } },
      },
    });
  }

  async listByProject(projectId: string, page?: number, pageSize?: number): Promise<Deployment[]> {
    return this.client.deployment.findMany({
      where: { projectId },
      orderBy: [{ version: "desc" }],
      ...(page !== undefined && pageSize !== undefined
        ? { skip: (page - 1) * pageSize, take: pageSize }
        : {}),
    });
  }

  async countByProject(projectId: string): Promise<number> {
    return this.client.deployment.count({ where: { projectId } });
  }

  async listRecent(limit: number): Promise<DeploymentWithProject[]> {
    return this.client.deployment.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        project: { include: { owner: { select: { id: true, email: true, displayName: true } } } },
      },
    });
  }

  async countByStatus(): Promise<{ status: Deployment["status"]; count: number }[]> {
    const rows = await this.client.deployment.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  async findActiveByProject(projectId: string): Promise<Deployment | null> {
    return this.client.deployment.findFirst({
      where: { projectId, active: true },
    });
  }

  async findActiveByProjects(projectIds: string[]): Promise<Deployment[]> {
    if (projectIds.length === 0) return [];
    return this.client.deployment.findMany({
      where: { projectId: { in: projectIds }, active: true },
    });
  }

  async latestByProjects(projectIds: string[]): Promise<Deployment[]> {
    if (projectIds.length === 0) return [];
    return this.client.deployment.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findSucceededByVersion(projectId: string, version: number): Promise<Deployment | null> {
    return this.client.deployment.findFirst({
      where: { projectId, version, status: "SUCCEEDED" },
    });
  }

  /**
   * Atomically claims the oldest QUEUED deployment for a worker using
   * `FOR UPDATE SKIP LOCKED`, so concurrent workers never claim the same job.
   */
  async claimQueued(workerId: string): Promise<Deployment | null> {
    return this.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Deployment"
        WHERE "status" = 'QUEUED'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const candidate = rows[0];
      if (!candidate) return null;
      return tx.deployment.update({
        where: { id: candidate.id },
        data: {
          status: "RUNNING",
          workerId,
          attempts: { increment: 1 },
          startedAt: new Date(),
          completedAt: null,
        },
      });
    });
  }

  /**
   * Resets a RUNNING/FAILED deployment back to QUEUED so it can be retried.
   * Returns false if the deployment is no longer in a retryable state
   * (e.g. another worker already completed it).
   */
  async requeueForRetry(id: string, error: string): Promise<boolean> {
    const result = await this.client.deployment.updateMany({
      where: { id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "QUEUED", workerId: null, startedAt: null, error: null, lastError: error },
    });
    return result.count > 0;
  }

  /**
   * Marks a RUNNING deployment as SUCCEEDED. Guarded so a stale worker can
   * never overwrite a newer state. Returns false when the deployment was not
   * RUNNING.
   */
  async setSucceeded(id: string, data: { url: string; sizeMb: number }): Promise<boolean> {
    const result = await this.client.deployment.updateMany({
      where: { id, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        url: data.url,
        sizeMb: data.sizeMb,
        error: null,
        completedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  /**
   * Marks a RUNNING deployment as FAILED with the recorded error. Returns false
   * when the deployment was not RUNNING.
   */
  async setFailed(id: string, error: string): Promise<boolean> {
    const result = await this.client.deployment.updateMany({
      where: { id, status: "RUNNING" },
      data: { status: "FAILED", error, completedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Marks a SUCCEEDED deployment as ROLLED_BACK (no longer active). Returns
   * false when the deployment was not SUCCEEDED.
   */
  async setRolledBack(id: string): Promise<boolean> {
    const result = await this.client.deployment.updateMany({
      where: { id, status: "SUCCEEDED" },
      data: { status: "ROLLED_BACK", active: false, completedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Deactivates every active deployment of a project. Returns the number of
   * deployments deactivated.
   */
  async deactivateByProject(projectId: string): Promise<number> {
    const result = await this.client.deployment.updateMany({
      where: { projectId, active: true },
      data: { active: false },
    });
    return result.count;
  }

  /**
   * Activates a SUCCEEDED deployment. Returns false when the deployment is not
   * SUCCEEDED, preventing activation of failed or rolled-back deployments.
   */
  async setActive(id: string): Promise<boolean> {
    const result = await this.client.deployment.updateMany({
      where: { id, status: "SUCCEEDED" },
      data: { active: true },
    });
    return result.count > 0;
  }

  /**
   * Recovers deployments left RUNNING by dead workers. If a worker stopped
   * heartbeating before `staleAfterMinutes`, its RUNNING deployments are either
   * requeued (attempts remaining) or marked FAILED (attempts exhausted).
   * Returns the number requeued and failed.
   */
  async recoverOrphans(
    staleAfterMinutes: number,
    maxAttempts: number,
  ): Promise<RecoverOrphansResult> {
    return this.client.$transaction(async (tx) => {
      const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);
      const stale = await tx.$queryRaw<{ id: string; attempts: number }[]>`
        SELECT d."id", d."attempts"
        FROM "Deployment" d
        WHERE d."status" = 'RUNNING'
          AND d."startedAt" < ${cutoff}
          AND (
            d."workerId" IS NULL
            OR EXISTS (
              SELECT 1 FROM "Worker" w
              WHERE w."id" = d."workerId"
                AND w."lastHeartbeatAt" < ${cutoff}
            )
          )
        FOR UPDATE
      `;
      let requeued = 0;
      let failed = 0;
      for (const row of stale) {
        if (row.attempts >= maxAttempts) {
          await tx.deployment.update({
            where: { id: row.id },
            data: {
              status: "FAILED",
              workerId: null,
              error: "Attempts exhausted after crash recovery",
              completedAt: new Date(),
            },
          });
          failed += 1;
        } else {
          await tx.deployment.update({
            where: { id: row.id },
            data: { status: "QUEUED", workerId: null, startedAt: null },
          });
          requeued += 1;
        }
      }
      return { requeued, failed };
    });
  }
}
