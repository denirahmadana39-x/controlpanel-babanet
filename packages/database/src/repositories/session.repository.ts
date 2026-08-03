import type { PrismaClient, Session } from "../../generated/client/client.js";

export interface CreateSessionInput {
  userId: string;
  ipAddress: string;
  userAgent: string | null;
  expiresAt: Date;
}

export class SessionRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateSessionInput): Promise<Session> {
    return this.client.session.create({ data: input });
  }

  async findById(id: string): Promise<Session | null> {
    return this.client.session.findUnique({ where: { id } });
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.client.session.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.client.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUserExcept(userId: string, exceptSessionId: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const sessions = await tx.session.findMany({
        where: { userId, id: { not: exceptSessionId }, revokedAt: null },
        select: { id: true },
      });
      const sessionIds = sessions.map((session) => session.id);
      if (sessionIds.length === 0) return;
      await tx.refreshToken.updateMany({
        where: { sessionId: { in: sessionIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { id: { in: sessionIds } },
        data: { revokedAt: new Date() },
      });
    });
  }
}
