import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createEventBus } from "@hosting/shared";
import { DeployService } from "@hosting/deploy";
import { createDatabase } from "@hosting/database";
import { createLogger } from "@hosting/logger";
import { loadNginxEngineConfig, NginxController } from "@hosting/nginx";
import { StorageManager } from "@hosting/storage";
import { loadEnv } from "./config/env.js";
import { buildLimits, DeploymentJobProcessor } from "./jobs/deployment-job.js";

const RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
const DRAIN_TIMEOUT_MS = 30_000;

const config = loadEnv(process.env);

const db = createDatabase({ connectionString: config.DATABASE_URL });
const logger = createLogger({ directory: config.LOG_DIRECTORY, level: config.LOG_LEVEL });

const eventBus = createEventBus();
eventBus.subscribe((event) => {
  logger.deploy(`domain event ${event.type}`, { ...event });
});

const storage = new StorageManager({
  uploadDirectory: config.UPLOAD_DIRECTORY,
  siteDirectory: config.SITE_DIRECTORY,
  backupDirectory: config.BACKUP_DIRECTORY,
  tempDirectory: config.TEMP_DIRECTORY,
});
storage.ensureRoots();

const nginx = new NginxController(loadNginxEngineConfig(process.env));

const deploy = new DeployService({
  storage,
  nginx,
  logger,
  limits: buildLimits(config.MAX_ZIP_ENTRIES, config.MAX_EXTRACTED_SIZE_MB),
  baseDomain: config.PUBLIC_BASE_DOMAIN,
  port: config.NGINX_PORT,
});

const processor = new DeploymentJobProcessor({
  db,
  deploy,
  storage,
  logger,
  eventBus,
  baseDomain: config.PUBLIC_BASE_DOMAIN,
  port: config.NGINX_PORT,
  retention: config.VERSION_RETENTION,
  tempAgeHours: config.TEMP_AGE_HOURS,
  maxAttempts: config.MAX_ATTEMPTS,
  staleAfterMinutes: config.STALE_AFTER_MINUTES,
});

const workerId = randomUUID();
const workerBindings = { workerId, hostname: hostname(), pid: process.pid };
let busy = false;
let shuttingDown = false;

async function registerWorker(): Promise<void> {
  await db.workers.register({ id: workerId, hostname: hostname(), pid: process.pid });
  logger.info(`worker registered`, workerBindings);
}

async function tick(): Promise<void> {
  if (busy || shuttingDown) return;
  busy = true;
  const startedAt = Date.now();
  try {
    await processor.processOnce(workerId);
  } catch (error) {
    logger.error(`worker job error: ${error instanceof Error ? error.message : String(error)}`, {
      ...workerBindings,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    busy = false;
  }
}

async function runCleanup(): Promise<void> {
  if (shuttingDown) return;
  try {
    await processor.cleanup();
  } catch (error) {
    logger.error(`cleanup error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runRecovery(): Promise<void> {
  if (shuttingDown) return;
  try {
    await processor.recoverOrphans();
  } catch (error) {
    logger.error(
      `orphan recovery error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const pollTimer = setInterval(() => void tick(), config.WORKER_POLL_MS);
const heartbeatTimer = setInterval(async () => {
  try {
    await db.workers.heartbeat(workerId);
  } catch (error) {
    logger.error(`heartbeat error: ${error instanceof Error ? error.message : String(error)}`);
  }
}, config.WORKER_HEARTBEAT_MS);
const cleanupTimer = setInterval(() => void runCleanup(), 60 * 60 * 1000);
const recoveryTimer = setInterval(() => void runRecovery(), RECOVERY_INTERVAL_MS);

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`received ${signal}, draining in-flight job`, workerBindings);
  clearInterval(pollTimer);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  clearInterval(recoveryTimer);

  const forceExit = setTimeout(() => {
    logger.error("graceful shutdown timed out, forcing exit");
    void db.client.$disconnect();
    process.exit(1);
  }, DRAIN_TIMEOUT_MS);
  forceExit.unref();

  void (async () => {
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (busy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await db.workers.stop(workerId);
    await db.client.$disconnect();
    process.exit(0);
  })();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  logger.error(`uncaught exception: ${error.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error(`unhandled rejection: ${String(reason)}`);
  process.exit(1);
});

void registerWorker().then(() => {
  void runRecovery();
  logger.info("worker started", workerBindings);
  void tick();
});
