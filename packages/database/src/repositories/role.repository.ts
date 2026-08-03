import type { Prisma, PrismaClient, Role } from "../../generated/client/client.js";

export type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: { permissions: { include: { permission: true } } };
}>;

export class RoleRepository {
  constructor(private readonly client: PrismaClient) {}

  async findByCode(code: string): Promise<Role | null> {
    return this.client.role.findUnique({ where: { code } });
  }

  async listByCodes(codes: string[]): Promise<Role[]> {
    return this.client.role.findMany({
      where: { code: { in: codes } },
      orderBy: { code: "asc" },
    });
  }

  async list(): Promise<RoleWithPermissions[]> {
    return this.client.role.findMany({
      orderBy: { code: "asc" },
      include: { permissions: { include: { permission: true } } },
    });
  }
}
