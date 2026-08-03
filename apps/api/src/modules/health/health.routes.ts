import type { FastifyInstance } from "fastify";

const WORKER_STALE_AFTER_MINUTES = 10;
const QUEUE_STUCK_AFTER_MINUTES = 2;

export type DatabaseStatus = "connected" | "disconnected";
export type WorkerStatus = "initialized" | "not-initialized" | "unknown";
export type QueueStatus = "ready" | "blocked" | "unknown";

export interface HealthResponse {
  status: "ok";
  uptime: number;
  timestamp: string;
  database: DatabaseStatus;
  worker: WorkerStatus;
  queue: QueueStatus;
}

async function checkDatabase(app: FastifyInstance): Promise<DatabaseStatus> {
  try {
    await app.db.client.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "disconnected";
  }
}

async function checkWorker(app: FastifyInstance): Promise<WorkerStatus> {
  try {
    const count = await app.db.workers.countActive(WORKER_STALE_AFTER_MINUTES);
    return count > 0 ? "initialized" : "not-initialized";
  } catch {
    return "unknown";
  }
}

async function checkQueue(app: FastifyInstance): Promise<QueueStatus> {
  try {
    const cutoff = new Date(Date.now() - QUEUE_STUCK_AFTER_MINUTES * 60_000);
    const stuck = await app.db.client.deployment.count({
      where: {
        status: { in: ["QUEUED", "RUNNING"] },
        createdAt: { lt: cutoff },
      },
    });
    return stuck > 0 ? "blocked" : "ready";
  } catch {
    return "unknown";
  }
}

async function health(app: FastifyInstance): Promise<HealthResponse> {
  const [database, worker, queue] = await Promise.all([
    checkDatabase(app),
    checkWorker(app),
    checkQueue(app),
  ]);
  return {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database,
    worker,
    queue,
  };
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: HealthResponse }>("/health", () => health(app));
  app.get<{ Reply: HealthResponse }>("/api/health", () => health(app));
}
