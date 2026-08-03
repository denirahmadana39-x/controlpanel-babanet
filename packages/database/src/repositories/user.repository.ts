import type { Prisma, PrismaClient, User } from "../../generated/client/client.js";

export type UserWithRoles = Prisma.UserGetPayload<{
  include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } };
  };
}>;

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface UpdateUserInput {
  email?: string;
  passwordHash?: string;
  displayName?: string;
  isActive?: boolean;
}

export class UserRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateUserInput): Promise<User> {
    return this.client.user.create({ data: input });
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    return this.client.user.findUnique({
      where: { id },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
  }

  async findByEmail(email: string): Promise<UserWithRoles | null> {
    return this.client.user.findUnique({
      where: { email },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
  }

  async list(): Promise<UserWithRoles[]> {
    return this.client.user.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
  }

  async count(): Promise<number> {
    return this.client.user.count();
  }

  async update(id: string, input: UpdateUserInput): Promise<User | null> {
    const existing = await this.client.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;
    return this.client.user.update({ where: { id }, data: input });
  }

  async setActive(id: string, isActive: boolean): Promise<User | null> {
    const existing = await this.client.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;
    return this.client.user.update({ where: { id }, data: { isActive } });
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.client.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return false;
    await this.client.user.delete({ where: { id } });
    return true;
  }

  async setRoles(userId: string, roleCodes: string[]): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      const roles = await tx.role.findMany({
        where: { code: { in: roleCodes } },
        select: { id: true },
      });
      if (roles.length === 0) return;
      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId, roleId: role.id })),
      });
    });
  }
}
