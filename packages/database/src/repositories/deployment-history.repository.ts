import type {
  Prisma,
  PrismaClient,
  DeploymentHistory,
  DeploymentStatus,
} from "../../generated/client/client.js";

export type DeploymentHistoryWithProject = Prisma.DeploymentHistoryGetPayload<{
  include: {
    project: { include: { owner: { select: { id: true; email: true; displayName: true } } } };
  };
}>;

export interface CreateDeploymentHistoryInput {
  projectId: string;
  deploymentId?: string;
  url?: string;
  sizeMb?: number;
  status: DeploymentStatus;
  metadata?: Prisma.InputJsonValue;
}

export class DeploymentHistoryRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateDeploymentHistoryInput): Promise<DeploymentHistory> {
    return this.client.deploymentHistory.create({
      data: {
        projectId: input.projectId,
        status: input.status,
        ...(input.deploymentId !== undefined ? { deploymentId: input.deploymentId } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.sizeMb !== undefined ? { sizeMb: input.sizeMb } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  }

  async listByProject(projectId: string, limit?: number): Promise<DeploymentHistory[]> {
    return this.client.deploymentHistory.findMany({
      where: { projectId },
      orderBy: { deployedAt: "desc" },
      ...(limit !== undefined ? { take: limit } : {}),
    });
  }

  async listRecent(limit: number): Promise<DeploymentHistoryWithProject[]> {
    return this.client.deploymentHistory.findMany({
      orderBy: { deployedAt: "desc" },
      take: limit,
      include: {
        project: { include: { owner: { select: { id: true, email: true, displayName: true } } } },
      },
    });
  }
}
