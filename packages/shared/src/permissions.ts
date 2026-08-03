import { ROLE_CODES, type RoleCode } from "./roles.js";

export const PERMISSION_CODES = {
  USERS_MANAGE: "users:manage",
  PROJECTS_VIEW: "projects:view",
  PROJECTS_CREATE: "projects:create",
  PROJECTS_UPDATE: "projects:update",
  PROJECTS_DELETE: "projects:delete",
  PROJECTS_SUSPEND: "projects:suspend",
  PROJECTS_DEPLOY: "projects:deploy",
  PROJECTS_ROLLBACK: "projects:rollback",
  FILES_MANAGE: "files:manage",
  DOMAINS_MANAGE: "domains:manage",
  SSL_MANAGE: "ssl:manage",
  SSL_ENABLE: "ssl:enable",
  LOGS_VIEW: "logs:view",
  MONITORING_VIEW: "monitoring:view",
} as const;

export type PermissionCode = (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES];

export const ALL_PERMISSION_CODES: readonly PermissionCode[] = Object.values(PERMISSION_CODES);

export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  [ROLE_CODES.admin]: ALL_PERMISSION_CODES,
  [ROLE_CODES.client]: [
    PERMISSION_CODES.PROJECTS_VIEW,
    PERMISSION_CODES.PROJECTS_CREATE,
    PERMISSION_CODES.PROJECTS_UPDATE,
    PERMISSION_CODES.PROJECTS_DELETE,
    PERMISSION_CODES.PROJECTS_DEPLOY,
    PERMISSION_CODES.PROJECTS_ROLLBACK,
    PERMISSION_CODES.FILES_MANAGE,
    PERMISSION_CODES.DOMAINS_MANAGE,
    PERMISSION_CODES.SSL_ENABLE,
    PERMISSION_CODES.LOGS_VIEW,
  ],
};
