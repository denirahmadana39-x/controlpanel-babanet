import type { Prisma, PrismaClient, Project } from "../../generated/client/client.js";
import { projectLockKeyPair } from "../project-lock.js";

export type ProjectWithOwner = Prisma.ProjectGetPayload<{
  include: { owner: { select: { id: true; email: true; displayName: true } } };
}>;

export interface CreateProjectInput {
  name: string;
  description?: string;
  ownerId: string;
  storageQuotaMb?: number;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: Project["status"];
  storageQuotaMb?: number;
}

export interface ProjectStatusCount {
  status: Project["status"];
  count: number;
}

export class ProjectRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateProjectInput): Promise<Project> {
    return this.client.project.create({ data: input });
  }

  async findById(id: string): Promise<ProjectWithOwner | null> {
    return this.client.project.findUnique({
      where: { id },
      include: { owner: { select: { id: true, email: true, displayName: true } } },
    });
  }

  async findByName(name: string): Promise<Project | null> {
    return this.client.project.findUnique({ where: { name } });
  }

  async listByOwner(ownerId: string): Promise<ProjectWithOwner[]> {
    return this.client.project.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      include: { owner: { select: { id: true, email: true, displayName: true } } },
    });
  }

  async listAll(): Promise<ProjectWithOwner[]> {
    return this.client.project.findMany({
      orderBy: { createdAt: "desc" },
      include: { owner: { select: { id: true, email: true, displayName: true } } },
    });
  }

  async countAll(): Promise<number> {
    return this.client.project.count();
  }

  /**
   * Runs `fn` while holding a Postgres advisory xact lock for the project.
   * Used to serialize operations (e.g. deploys/rollbacks) for a single project
   * across concurrent workers.
   */
  async withProjectLock<T>(
    projectId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const lockKey = projectLockKeyPair(projectId);
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey.a}, ${lockKey.b})::text AS "locked"`;
      return fn(tx);
    });
  }

  async countByStatus(): Promise<ProjectStatusCount[]> {
    const rows = await this.client.project.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project | null> {
    const existing = await this.client.project.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;
    return this.client.project.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.client.project.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return false;
    await this.client.project.delete({ where: { id } });
    return true;
  }
}
