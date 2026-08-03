import type { PrismaClient, Backup } from "../../generated/client/client.js";

export class BackupRepository {
  constructor(private readonly client: PrismaClient) {}

  async sumSizeMb(): Promise<number> {
    const result = await this.client.backup.aggregate({
      _sum: { sizeMb: true },
    });
    return result._sum.sizeMb ?? 0;
  }

  async count(): Promise<number> {
    return this.client.backup.count();
  }

  async create(input: { projectId: string; sizeMb?: number; path?: string }): Promise<Backup> {
    return this.client.backup.create({
      data: {
        projectId: input.projectId,
        sizeMb: input.sizeMb ?? null,
        path: input.path ?? null,
      },
    });
  }
}
