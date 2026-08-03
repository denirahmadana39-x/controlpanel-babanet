import type { ActivityLog, Prisma, PrismaClient } from "../../generated/client/client.js";

export interface CreateActivityLogInput {
  userId: string;
  projectId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export class ActivityLogRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateActivityLogInput): Promise<ActivityLog> {
    return this.client.activityLog.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  }

  async listRecent(limit: number): Promise<ActivityLog[]> {
    return this.client.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listByUser(userId: string, limit: number): Promise<ActivityLog[]> {
    return this.client.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listByProject(projectId: string, limit: number): Promise<ActivityLog[]> {
    return this.client.activityLog.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
