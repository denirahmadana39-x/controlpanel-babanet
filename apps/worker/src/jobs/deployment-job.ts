import { ENGINE_LIMITS, domainEvent, type EventBus } from "@hosting/shared";
import { DeploymentPipelineError, type DeployService } from "@hosting/deploy";
import { withProjectTransaction, type Database, type Deployment } from "@hosting/database";
import type { HostingLogger } from "@hosting/logger";
import type { StorageManager } from "@hosting/storage";

const MB = 1024 * 1024;

export interface DeploymentJobOptions {
  db: Database;
  deploy: DeployService;
  storage: StorageManager;
  logger: HostingLogger;
  eventBus?: EventBus;
  baseDomain: string;
  port: number;
  retention: number;
  tempAgeHours: number;
  maxAttempts: number;
  staleAfterMinutes: number;
}

export class DeploymentJobProcessor {
  constructor(private readonly options: DeploymentJobOptions) {}

  async processOnce(workerId: string): Promise<void> {
    const { db, logger } = this.options;
    const deployment = await db.deployments.claimQueued(workerId);
    if (!deployment) return;

    const jobLogger = logger.child({
      deploymentId: deployment.id,
      projectId: deployment.projectId,
      version: deployment.version,
    });
    jobLogger.deploy(`claimed deployment ${deployment.id}`, {
      attempt: deployment.attempts,
      rollbackOfVersion: deployment.rollbackOfVersion ?? null,
    });

    if (deployment.rollbackOfVersion !== null) {
      await this.processRollback(deployment, jobLogger);
    } else {
      await this.processDeploy(deployment, jobLogger);
    }
  }

  private async processDeploy(deployment: Deployment, jobLogger: HostingLogger): Promise<void> {
    const { db, deploy, storage, eventBus } = this.options;
    try {
      if (!deployment.uploadPath) {
        throw new Error("Deployment has no uploaded archive");
      }
      const uploadPath = deployment.uploadPath;
      const project = await db.projects.findById(deployment.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      if (project.status === "SUSPENDED") {
        throw new Error("Project is suspended");
      }

      const { hostnames, primaryHostname } = await this.hostnames(project.id, project.name);
      const usage = await db.storageUsage.findByProject(project.id);
      const quotaMb = usage?.quotaMb ?? project.storageQuotaMb;

      // The deploy (fs + nginx) and every DB write happen under the project's
      // advisory lock in a single transaction, so a deployment either records
      // fully or rolls back without partial state.
      const result = await withProjectTransaction(db, project.id, async (txDb) => {
        const deployResult = await deploy.deploy({
          projectId: project.id,
          projectName: project.name,
          deploymentId: deployment.id,
          version: deployment.version,
          uploadZipPath: uploadPath,
          hostnames,
          primaryHostname,
          quotaMb,
        });

        const completed = await txDb.deployments.setSucceeded(deployment.id, {
          url: deployResult.url,
          sizeMb: deployResult.sizeMb,
        });
        if (!completed) {
          throw new DeploymentPipelineError("Deployment is no longer RUNNING; skipping record");
        }

        await txDb.deployments.deactivateByProject(project.id);
        await txDb.deployments.setActive(deployment.id);

        await txDb.files.replaceProjectFiles(
          project.id,
          deployResult.files.map((file) => ({
            path: file.path,
            fileType: "FILE" as const,
            ...(file.mimeType !== null && file.mimeType !== undefined
              ? { mimeType: file.mimeType }
              : {}),
            sizeBytes: file.sizeBytes,
            checksumSha256: file.checksumSha256,
          })),
        );

        const usedMb = Math.max(0, Math.ceil(storage.computeSizeBytes(deployResult.liveDir) / MB));
        await txDb.storageUsage.setUsed(project.id, usedMb);

        await txDb.deploymentHistory.create({
          projectId: project.id,
          deploymentId: deployment.id,
          url: deployResult.url,
          sizeMb: deployResult.sizeMb,
          status: "SUCCEEDED",
          metadata: {
            version: deployResult.version,
            trigger: deployment.trigger,
            files: deployResult.fileCount,
          },
        });

        if (project.status === "DRAFT") {
          await txDb.projects.update(project.id, { status: "ACTIVE" });
        }

        if (deployResult.previousVersion !== null) {
          const previousDir = storage.projectVersionDir(project.id, deployResult.previousVersion);
          await txDb.backups.create({
            projectId: project.id,
            sizeMb: Math.max(0, Math.ceil(storage.computeSizeBytes(previousDir) / MB)),
            path: previousDir,
          });
        }

        return deployResult;
      });

      if (deployment.uploadPath) {
        storage.deletePath(deployment.uploadPath);
      }

      eventBus?.publish(
        domainEvent({
          type: "deployment.completed",
          deploymentId: deployment.id,
          projectId: project.id,
          version: result.version,
          url: result.url,
          sizeMb: result.sizeMb,
        }),
      );

      jobLogger.deploy(`deployment ${deployment.id} recorded`, {
        projectId: project.id,
        version: result.version,
        url: result.url,
        sizeMb: result.sizeMb,
        previousVersion: result.previousVersion,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.handleFailure(deployment, message, "deployment", jobLogger);
    }
  }

  private async processRollback(deployment: Deployment, jobLogger: HostingLogger): Promise<void> {
    const { db, deploy, storage, eventBus } = this.options;
    const targetVersion = deployment.rollbackOfVersion;
    try {
      if (targetVersion === null) throw new Error("Rollback target version missing");
      const project = await db.projects.findById(deployment.projectId);
      if (!project) throw new Error("Project not found");

      const { hostnames, primaryHostname } = await this.hostnames(project.id, project.name);

      const result = await withProjectTransaction(db, project.id, async (txDb) => {
        const rollbackResult = await deploy.rollback({
          projectId: project.id,
          projectName: project.name,
          deploymentId: deployment.id,
          version: deployment.version,
          targetVersion,
          hostnames,
          primaryHostname,
        });

        const active = await txDb.deployments.findActiveByProject(project.id);
        const target = await txDb.deployments.findSucceededByVersion(project.id, targetVersion);

        await txDb.deployments.deactivateByProject(project.id);
        if (active && active.version !== targetVersion && active.status === "SUCCEEDED") {
          await txDb.deployments.setRolledBack(active.id);
        }

        const completed = await txDb.deployments.setSucceeded(deployment.id, {
          url: rollbackResult.url,
          sizeMb: target?.sizeMb ?? 0,
        });
        if (!completed) {
          throw new DeploymentPipelineError("Deployment is no longer RUNNING; skipping record");
        }
        await txDb.deployments.setActive(deployment.id);

        const usedMb = Math.max(
          0,
          Math.ceil(storage.computeSizeBytes(rollbackResult.liveDir) / MB),
        );
        await txDb.storageUsage.setUsed(project.id, usedMb);

        await txDb.deploymentHistory.create({
          projectId: project.id,
          deploymentId: deployment.id,
          url: rollbackResult.url,
          sizeMb: target?.sizeMb ?? 0,
          status: "SUCCEEDED",
          metadata: { version: deployment.version, rolledBackTo: targetVersion },
        });

        return { url: rollbackResult.url, targetVersion };
      });

      eventBus?.publish(
        domainEvent({
          type: "rollback.completed",
          deploymentId: deployment.id,
          projectId: project.id,
          targetVersion: result.targetVersion,
        }),
      );

      jobLogger.deploy(`rollback ${deployment.id} recorded`, {
        projectId: project.id,
        version: deployment.version,
        targetVersion: result.targetVersion,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.handleFailure(deployment, message, "rollback", jobLogger);
    }
  }

  /**
   * On failure: requeue for retry while attempts remain, otherwise dead-letter
   * the deployment as FAILED with the last error recorded. The upload archive
   * is kept for retries and deleted only on permanent failure.
   */
  private async handleFailure(
    deployment: Deployment,
    message: string,
    kind: "deployment" | "rollback",
    jobLogger: HostingLogger,
  ): Promise<void> {
    const { db, storage, eventBus, maxAttempts } = this.options;
    const projectId = deployment.projectId;
    const version = deployment.version;

    if (deployment.attempts < maxAttempts) {
      const requeued = await db.deployments.requeueForRetry(deployment.id, message);
      if (!requeued) {
        jobLogger.warn(`could not requeue ${kind} ${deployment.id} (state changed)`);
        return;
      }
      eventBus?.publish(
        domainEvent({
          type: "deployment.requeued",
          deploymentId: deployment.id,
          projectId,
          version,
          attempt: deployment.attempts,
          error: message,
        }),
      );
      jobLogger.deploy(`${kind} ${deployment.id} requeued for retry`, {
        projectId,
        version,
        attempt: deployment.attempts,
        error: message,
      });
      return;
    }

    const failed = await db.deployments.setFailed(deployment.id, message);
    if (!failed) {
      jobLogger.warn(`could not mark ${kind} ${deployment.id} failed (state changed)`);
      return;
    }

    await db.deploymentHistory.create({
      projectId,
      deploymentId: deployment.id,
      status: "FAILED",
      metadata: {
        version,
        ...(kind === "rollback" ? { rolledBackTo: deployment.rollbackOfVersion } : {}),
        error: message,
      },
    });

    if (kind === "deployment" && deployment.uploadPath) {
      storage.deletePath(deployment.uploadPath);
    }

    if (kind === "rollback") {
      eventBus?.publish(
        domainEvent({
          type: "rollback.failed",
          deploymentId: deployment.id,
          projectId,
          targetVersion: deployment.rollbackOfVersion ?? 0,
          error: message,
        }),
      );
    } else {
      eventBus?.publish(
        domainEvent({
          type: "deployment.failed",
          deploymentId: deployment.id,
          projectId,
          version,
          error: message,
        }),
      );
    }

    jobLogger.deploy(`${kind} ${deployment.id} failed permanently`, {
      projectId,
      version,
      attempt: deployment.attempts,
      error: message,
    });
  }

  private async hostnames(
    projectId: string,
    projectName: string,
  ): Promise<{ hostnames: string[]; primaryHostname: string }> {
    const domains = await this.options.db.domains.listByProject(projectId);
    const defaultHost = `${projectName}.${this.options.baseDomain}`;
    const hostnames = [defaultHost, ...domains.map((domain) => domain.hostname)];
    const primary = domains.find((domain) => domain.isPrimary) ?? domains[0];
    return { hostnames, primaryHostname: primary?.hostname ?? defaultHost };
  }

  async cleanup(): Promise<void> {
    const { db, storage, retention, tempAgeHours, staleAfterMinutes, logger } = this.options;
    const now = Date.now();

    for (const project of await db.projects.listAll()) {
      const dirs = storage.listProjectVersionDirs(project.id);
      if (dirs.length > retention) {
        for (const dir of dirs.slice(retention)) {
          storage.deletePath(dir);
          logger.deploy(`pruned old deployment directory ${dir}`, { projectId: project.id });
        }
      }
    }

    for (const entry of storage.listTempDirs()) {
      const mtime = entry.mtimeMs;
      if (now - mtime > tempAgeHours * 60 * 60 * 1000) {
        storage.deletePath(entry.path);
        logger.deploy(`cleaned stale temp directory ${entry.path}`, {});
      }
    }

    const pruned = await db.workers.pruneStale(staleAfterMinutes);
    if (pruned > 0) {
      logger.info(`pruned ${pruned} stale worker registrations`);
    }
  }

  async recoverOrphans(): Promise<void> {
    const { db, logger, staleAfterMinutes, maxAttempts } = this.options;
    const result = await db.deployments.recoverOrphans(staleAfterMinutes, maxAttempts);
    if (result.requeued > 0 || result.failed > 0) {
      logger.info(`orphan recovery: requeued=${result.requeued} failed=${result.failed}`);
    }
  }
}

export function buildLimits(maxEntries: number, maxExtractedSizeMb: number) {
  return {
    maxEntries,
    maxExtractedSizeBytes: maxExtractedSizeMb * MB,
    maxSingleFileSizeBytes: ENGINE_LIMITS.MAX_SINGLE_FILE_SIZE_MB * MB,
  };
}
