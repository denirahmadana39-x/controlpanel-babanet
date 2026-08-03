import type { Prisma, PrismaClient, FileType } from "../../generated/client/client.js";

export interface FileRecordInput {
  path: string;
  fileType: FileType;
  mimeType?: string;
  sizeBytes: number;
  checksumSha256?: string;
}

export interface FileListing {
  path: string;
  fileType: FileType;
  mimeType: string | null;
  sizeBytes: number;
  checksumSha256: string | null;
  updatedAt: Date;
}

export class FileRepository {
  constructor(private readonly client: PrismaClient) {}

  /**
   * Replaces all file records of a project. When `tx` is provided the operation
   * runs inside that existing transaction so it can be composed into an atomic
   * multi-step deploy/rollback.
   */
  async replaceProjectFiles(
    projectId: string,
    files: FileRecordInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.client;
    await client.file.deleteMany({ where: { projectId } });
    if (files.length > 0) {
      await client.file.createMany({
        data: files.map((file) => ({
          projectId,
          path: file.path,
          fileType: file.fileType,
          sizeBytes: file.sizeBytes,
          ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
          ...(file.checksumSha256 !== undefined ? { checksumSha256: file.checksumSha256 } : {}),
        })),
      });
    }
  }

  async listByProject(projectId: string): Promise<FileListing[]> {
    const rows = await this.client.file.findMany({
      where: { projectId },
      orderBy: [{ path: "asc" }],
      select: {
        path: true,
        fileType: true,
        mimeType: true,
        sizeBytes: true,
        checksumSha256: true,
        updatedAt: true,
      },
    });
    return rows;
  }

  async deleteByPathPrefix(projectId: string, prefix: string): Promise<number> {
    const result = await this.client.file.deleteMany({
      where: {
        projectId,
        OR: [{ path: prefix }, { path: { startsWith: `${prefix}/` } }],
      },
    });
    return result.count;
  }

  async deleteByProject(projectId: string): Promise<number> {
    const result = await this.client.file.deleteMany({ where: { projectId } });
    return result.count;
  }

  async countByProject(projectId: string): Promise<number> {
    return this.client.file.count({ where: { projectId } });
  }

  async countByProjects(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.client.file.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.projectId, row._count._all]));
  }

  async sumSizeBytesByProject(projectId: string): Promise<number> {
    const result = await this.client.file.aggregate({
      where: { projectId },
      _sum: { sizeBytes: true },
    });
    return result._sum.sizeBytes ?? 0;
  }
}
