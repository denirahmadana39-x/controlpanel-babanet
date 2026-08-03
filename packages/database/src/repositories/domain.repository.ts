import type { PrismaClient, Domain } from "../../generated/client/client.js";

export interface CreateDomainInput {
  projectId: string;
  hostname: string;
  isPrimary?: boolean;
}

export class DomainRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateDomainInput): Promise<Domain> {
    return this.client.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.domain.updateMany({
          where: { projectId: input.projectId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.domain.create({
        data: {
          projectId: input.projectId,
          hostname: input.hostname,
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        },
      });
    });
  }

  async listByProject(projectId: string): Promise<Domain[]> {
    return this.client.domain.findMany({
      where: { projectId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
  }

  async findById(id: string): Promise<Domain | null> {
    return this.client.domain.findUnique({ where: { id } });
  }

  async findByHostname(hostname: string): Promise<Domain | null> {
    return this.client.domain.findUnique({ where: { hostname } });
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.client.domain.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return false;
    await this.client.domain.delete({ where: { id } });
    return true;
  }

  async setPrimary(projectId: string, id: string): Promise<Domain | null> {
    return this.client.$transaction(async (tx) => {
      const target = await tx.domain.findFirst({ where: { id, projectId } });
      if (!target) return null;
      await tx.domain.updateMany({
        where: { projectId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.domain.update({ where: { id }, data: { isPrimary: true } });
    });
  }

  async setVerified(id: string): Promise<void> {
    await this.client.domain.update({
      where: { id },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });
  }

  async countByProject(projectId: string): Promise<number> {
    return this.client.domain.count({ where: { projectId } });
  }

  async countByProjects(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.client.domain.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.projectId, row._count._all]));
  }
}
