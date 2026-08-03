import { ROLE_CODES } from "@hosting/shared";
import { AppError } from "../../errors/app-error.js";
import type { AuthUser } from "../../types/fastify.js";

export function assertProjectAccess(user: AuthUser, project: { ownerId: string }): void {
  const isAdmin = user.roles.includes(ROLE_CODES.admin);
  if (!isAdmin && project.ownerId !== user.id) {
    throw new AppError(403, "FORBIDDEN", "You do not have access to this project");
  }
}
