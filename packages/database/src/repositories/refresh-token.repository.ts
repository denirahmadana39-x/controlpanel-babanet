import type { PrismaClient, RefreshToken } from "../../generated/client/client.js";

export interface CreateRefreshTokenInput {
  tokenHash: string;
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

export class RefreshTokenRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    return this.client.refreshToken.create({ data: input });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.client.refreshToken.findUnique({ where: { tokenHash } });
  }

  async markRotated(id: string, replacedByTokenId: string): Promise<void> {
    await this.client.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), replacedByTokenId },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.client.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForSession(sessionId: string): Promise<void> {
    await this.client.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
