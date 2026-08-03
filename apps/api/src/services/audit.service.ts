import type { FastifyRequest } from "fastify";
import type {
  CreateActivityLogInput,
  CreateAuditLogInput,
  Database,
  Prisma,
} from "@hosting/database";

export interface AuditEntry {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  success?: boolean;
}

export interface ActivityEntry {
  userId: string;
  projectId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

export class AuditService {
  constructor(private readonly db: Database) {}

  async audit(entry: AuditEntry, request?: FastifyRequest): Promise<void> {
    const input: CreateAuditLogInput = {
      action: entry.action,
      entityType: entry.entityType,
      ...(entry.userId !== undefined ? { userId: entry.userId } : {}),
      ...(entry.entityId !== undefined ? { entityId: entry.entityId } : {}),
      ...(entry.success !== undefined ? { success: entry.success } : {}),
      ...(request !== undefined
        ? { ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null }
        : {}),
    };
    if (request !== undefined) {
      const base =
        entry.metadata !== undefined &&
        typeof entry.metadata === "object" &&
        entry.metadata !== null
          ? (entry.metadata as Record<string, unknown>)
          : {};
      input.metadata = { ...base, requestId: request.id } as Prisma.InputJsonValue;
    } else if (entry.metadata !== undefined) {
      input.metadata = entry.metadata;
    }
    await this.db.auditLogs.create(input);
  }

  async activity(entry: ActivityEntry): Promise<void> {
    const input: CreateActivityLogInput = {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
      ...(entry.entityId !== undefined ? { entityId: entry.entityId } : {}),
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    };
    await this.db.activityLogs.create(input);
  }
}
