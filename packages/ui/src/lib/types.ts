export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
}

export interface SessionResponse {
  user: AuthUser;
  csrfToken: string;
  expiresIn: number;
}

export interface UserRole {
  id: string;
  code: string;
  description: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  roles: UserRole[];
}

export interface UserListResponse {
  users: AdminUser[];
}

export interface UserResponse {
  user: AdminUser;
}

export type ProjectStatus = "DRAFT" | "ACTIVE" | "SUSPENDED";

export interface ProjectOwner {
  id: string;
  email: string;
  displayName: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  storageQuotaMb: number;
  createdAt: string;
  updatedAt: string;
  owner: ProjectOwner;
}

export interface ProjectListResponse {
  projects: Project[];
}

export interface ProjectResponse {
  project: Project;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  storageQuotaMb?: number;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  storageQuotaMb?: number;
}

export interface SystemInfo {
  status: "ok";
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  uptimeSeconds: number;
  cpu: {
    cores: number;
    loadAvg: [number, number, number];
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
  disk: {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
}

export interface StorageInfo {
  totalQuotaMb: number;
  totalUsedMb: number;
  usagePercent: number;
  projects: Array<{
    projectId: string;
    projectName: string;
    ownerId: string;
    ownerEmail: string;
    usedMb: number;
    quotaMb: number;
    usagePercent: number;
  }>;
  backups: {
    count: number;
    totalSizeMb: number;
  };
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  roles?: string[];
}

export interface UpdateUserInput {
  email?: string;
  password?: string;
  displayName?: string;
  isActive?: boolean;
}
