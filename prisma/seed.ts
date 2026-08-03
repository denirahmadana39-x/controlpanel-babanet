import "dotenv/config";
import { hashPassword } from "@hosting/auth";
import { createPrismaClient } from "@hosting/database";
import { PERMISSION_CODES, ROLE_CODES, ROLE_PERMISSIONS } from "@hosting/shared";
import { PASSWORD_POLICY } from "@hosting/shared";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the seed");
  }
  const client = createPrismaClient({ connectionString });

  try {
    const permissionDescriptions: Record<string, string> = {
      "users:manage": "Create, update and delete platform users",
      "projects:view": "View projects",
      "projects:create": "Create projects",
      "projects:update": "Update project settings",
      "projects:delete": "Delete projects",
      "projects:suspend": "Suspend or resume a project",
      "projects:deploy": "Trigger deployments",
      "projects:rollback": "Roll back to a previous deployment",
      "files:manage": "Manage project files",
      "domains:manage": "Manage project domains",
      "ssl:manage": "Manage SSL certificates",
      "ssl:enable": "Enable SSL on a domain",
      "logs:view": "View logs",
      "monitoring:view": "View system monitoring",
    };

    for (const code of Object.values(PERMISSION_CODES)) {
      await client.permission.upsert({
        where: { code },
        update: { description: permissionDescriptions[code] ?? null },
        create: { code, description: permissionDescriptions[code] ?? null },
      });
    }

    const roleDescriptions: Record<string, string> = {
      admin: "Platform operator with full control",
      client: "Tenant hosting static websites",
    };

    for (const roleCode of Object.keys(ROLE_PERMISSIONS)) {
      const role = await client.role.upsert({
        where: { code: roleCode },
        update: { description: roleDescriptions[roleCode] ?? null },
        create: { code: roleCode, description: roleDescriptions[roleCode] ?? null },
      });

      const permissionCodes = ROLE_PERMISSIONS[roleCode as keyof typeof ROLE_PERMISSIONS];
      await client.rolePermission.deleteMany({ where: { roleId: role.id } });
      const permissions = await client.permission.findMany({
        where: { code: { in: [...permissionCodes] } },
        select: { id: true },
      });
      if (permissions.length > 0) {
        await client.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
        });
      }
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminEmail || adminEmail.trim().length === 0) {
      throw new Error("ADMIN_EMAIL is required to run the seed");
    }
    if (!adminPassword || adminPassword.length < PASSWORD_POLICY.minLength) {
      throw new Error(
        `ADMIN_PASSWORD is required and must be at least ${PASSWORD_POLICY.minLength} characters`,
      );
    }

    const adminRole = await client.role.findUnique({ where: { code: ROLE_CODES.admin } });
    if (!adminRole) {
      throw new Error("Admin role is missing");
    }

    const passwordHash = await hashPassword(adminPassword);
    const admin = await client.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        passwordHash,
        displayName: "Platform Administrator",
      },
    });

    await client.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
      update: {},
      create: { userId: admin.id, roleId: adminRole.id },
    });

    console.log("Seed complete: permissions, roles and admin user ready.");
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
