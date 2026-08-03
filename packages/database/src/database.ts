import { createPrismaClient, type DatabaseClientConfig, type PrismaClient } from "./client.js";
import {
  ActivityLogRepository,
  AuditLogRepository,
  BackupRepository,
  DeploymentHistoryRepository,
  DeploymentRepository,
  DomainRepository,
  FileRepository,
  PermissionRepository,
  ProjectRepository,
  RefreshTokenRepository,
  RoleRepository,
  SessionRepository,
  StorageUsageRepository,
  UserRepository,
  WorkerRepository,
} from "./repositories/index.js";

export type DatabaseConfig = DatabaseClientConfig;

export interface Database {
  client: PrismaClient;
  users: UserRepository;
  roles: RoleRepository;
  permissions: PermissionRepository;
  sessions: SessionRepository;
  refreshTokens: RefreshTokenRepository;
  projects: ProjectRepository;
  auditLogs: AuditLogRepository;
  activityLogs: ActivityLogRepository;
  storageUsage: StorageUsageRepository;
  backups: BackupRepository;
  deployments: DeploymentRepository;
  deploymentHistory: DeploymentHistoryRepository;
  domains: DomainRepository;
  files: FileRepository;
  workers: WorkerRepository;
}

function buildRepositories(client: PrismaClient): Omit<Database, "client"> {
  return {
    users: new UserRepository(client),
    roles: new RoleRepository(client),
    permissions: new PermissionRepository(client),
    sessions: new SessionRepository(client),
    refreshTokens: new RefreshTokenRepository(client),
    projects: new ProjectRepository(client),
    auditLogs: new AuditLogRepository(client),
    activityLogs: new ActivityLogRepository(client),
    storageUsage: new StorageUsageRepository(client),
    backups: new BackupRepository(client),
    deployments: new DeploymentRepository(client),
    deploymentHistory: new DeploymentHistoryRepository(client),
    domains: new DomainRepository(client),
    files: new FileRepository(client),
    workers: new WorkerRepository(client),
  };
}

export function createDatabase(config: DatabaseConfig): Database {
  const client = createPrismaClient(config);
  return { client, ...buildRepositories(client) };
}

/**
 * Runs `fn` with a transaction-scoped Database while holding the project's
 * advisory lock. Every repository call inside `fn` uses the same transaction,
 * so multi-step deploys/rollbacks either commit atomically or roll back.
 * Serializes concurrent workers operating on the same project.
 */
export async function withProjectTransaction<T>(
  db: Database,
  projectId: string,
  fn: (txDb: Database) => Promise<T>,
): Promise<T> {
  return db.projects.withProjectLock(projectId, async (tx) => {
    const txClient = tx as unknown as PrismaClient;
    return fn({ client: txClient, ...buildRepositories(txClient) });
  });
}

export async function closeDatabase(database: Database): Promise<void> {
  await database.client.$disconnect();
}
