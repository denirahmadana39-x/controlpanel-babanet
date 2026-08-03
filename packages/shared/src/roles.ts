export const ROLE_CODES = {
  admin: "admin",
  client: "client",
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];
