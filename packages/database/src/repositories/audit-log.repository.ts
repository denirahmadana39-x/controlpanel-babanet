import type { AuditLog, Prisma, PrismaClient } from "../../generated/client/client.js";

export interface CreateAuditLogInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
}

export class AuditLogRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    return this.client.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: input.success ?? true,
      },
    });
  }

  async listRecent(limit: number): Promise<AuditLog[]> {
    return this.client.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listByUser(userId: string, limit: number): Promise<AuditLog[]> {
    return this.client.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
