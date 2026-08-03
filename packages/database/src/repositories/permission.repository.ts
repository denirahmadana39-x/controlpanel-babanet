import type { PrismaClient, Permission } from "../../generated/client/client.js";

export class PermissionRepository {
  constructor(private readonly client: PrismaClient) {}

  async listAll(): Promise<Permission[]> {
    return this.client.permission.findMany({
      orderBy: { code: "asc" },
    });
  }

  async listCodesForUser(userId: string): Promise<string[]> {
    const rows = await this.client.permission.findMany({
      where: {
        roles: {
          some: {
            role: {
              users: { some: { userId } },
            },
          },
        },
      },
      select: { code: true },
      orderBy: { code: "asc" },
    });
    return rows.map((row) => row.code);
  }
}
