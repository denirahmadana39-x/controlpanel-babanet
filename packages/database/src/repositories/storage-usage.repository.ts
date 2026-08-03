import type { PrismaClient, StorageUsage } from "../../generated/client/client.js";

export interface StorageUsageWithProject {
  id: string;
  projectId: string;
  usedMb: number;
  quotaMb: number;
  updatedAt: Date;
  project: {
    name: string;
    ownerId: string;
    owner: { id: string; email: string; displayName: string };
  };
}

export class StorageUsageRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(projectId: string, quotaMb: number): Promise<StorageUsage> {
    return this.client.storageUsage.create({
      data: { projectId, usedMb: 0, quotaMb },
    });
  }

  async findByProject(projectId: string): Promise<StorageUsage | null> {
    return this.client.storageUsage.findUnique({ where: { projectId } });
  }

  async findByProjects(projectIds: string[]): Promise<StorageUsage[]> {
    if (projectIds.length === 0) return [];
    return this.client.storageUsage.findMany({
      where: { projectId: { in: projectIds } },
    });
  }

  async listAllWithProjects(): Promise<StorageUsageWithProject[]> {
    const rows = await this.client.storageUsage.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        project: {
          include: { owner: { select: { id: true, email: true, displayName: true } } },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      usedMb: row.usedMb,
      quotaMb: row.quotaMb,
      updatedAt: row.updatedAt,
      project: {
        name: row.project.name,
        ownerId: row.project.ownerId,
        owner: row.project.owner,
      },
    }));
  }

  async setUsed(projectId: string, usedMb: number): Promise<void> {
    await this.client.storageUsage.update({
      where: { projectId },
      data: { usedMb },
    });
  }
}
