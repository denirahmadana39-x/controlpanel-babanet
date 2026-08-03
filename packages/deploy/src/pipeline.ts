import { join } from "node:path";
import type { HostingLogger } from "@hosting/logger";
import type { NginxController } from "@hosting/nginx";
import type { StorageManager, ZipLimits } from "@hosting/storage";
import { extractZipSafe, locateSiteRoot } from "@hosting/storage";
import { generateSiteConfig } from "@hosting/nginx";
import { DEFAULT_INDEX_FILE } from "@hosting/shared";

export interface DeployContext {
  storage: StorageManager;
  nginx: NginxController;
  logger: HostingLogger;
  limits: ZipLimits;
  baseDomain: string;
  port: number;
}

export interface DeployInput {
  projectId: string;
  projectName: string;
  deploymentId: string;
  version: number;
  uploadZipPath: string;
  hostnames: string[];
  primaryHostname: string;
  quotaMb: number;
}

export interface DeployedFile {
  path: string;
  sizeBytes: number;
  mimeType: string | null;
  checksumSha256: string;
}

export interface DeployResult {
  version: number;
  url: string;
  sizeMb: number;
  fileCount: number;
  files: DeployedFile[];
  previousVersion: number | null;
  liveDir: string;
  versionDir: string;
}

export interface RollbackInput {
  projectId: string;
  projectName: string;
  deploymentId: string;
  version: number;
  targetVersion: number;
  hostnames: string[];
  primaryHostname: string;
}

export interface RollbackResult {
  version: number;
  targetVersion: number;
  url: string;
  liveDir: string;
  versionDir: string;
}

export class DeploymentPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentPipelineError";
  }
}

export class DeployService {
  constructor(private readonly context: DeployContext) {}

  async deploy(input: DeployInput): Promise<DeployResult> {
    const { storage, nginx, logger } = this.context;
    const tempDir = storage.tempExtractDir(input.deploymentId);
    const liveDir = storage.projectLiveDir(input.projectId);
    const versionDir = storage.projectVersionDir(input.projectId, input.version);
    const previousVersion = storage.readLiveVersion(input.projectId);
    let previousConfig: string | null = null;

    logger.deploy(`deploying ${input.projectId} version ${input.version}`, {
      projectId: input.projectId,
      version: input.version,
      upload: input.uploadZipPath,
    });

    try {
      logger.deploy(`extracting archive for ${input.deploymentId}`);
      const extracted = extractZipSafe(input.uploadZipPath, tempDir, this.context.limits);
      const siteRoot = locateSiteRoot(tempDir);
      if (!storage.pathExists(join(siteRoot, DEFAULT_INDEX_FILE))) {
        throw new DeploymentPipelineError(`Archive must contain ${DEFAULT_INDEX_FILE} at its root`);
      }

      if (
        storage.pathExists(liveDir) &&
        !storage.isManagedSymlink(liveDir) &&
        storage.isDirectory(liveDir)
      ) {
        throw new DeploymentPipelineError(
          `Live directory for project is not a managed symlink: ${liveDir}`,
        );
      }

      storage.deletePath(versionDir);
      const copied = storage.copyTree(siteRoot, versionDir);

      const sizeMb = Math.max(1, Math.ceil(copied.totalBytes / (1024 * 1024)));
      if (sizeMb > input.quotaMb) {
        throw new DeploymentPipelineError(
          `Deployment exceeds storage quota (${sizeMb}MB > ${input.quotaMb}MB)`,
        );
      }

      storage.activateVersion(input.projectId, input.version);

      previousConfig = await nginx.readSiteConfig(input.projectId);
      const config = generateSiteConfig({
        projectId: input.projectId,
        hostnames: input.hostnames,
        root: liveDir,
        port: this.context.port,
      });
      await nginx.applySiteConfig(input.projectId, config);

      const files = this.collectFiles(extracted);
      storage.deletePath(tempDir);
      const result: DeployResult = {
        version: input.version,
        url: `http://${input.primaryHostname}`,
        sizeMb,
        fileCount: files.length,
        files,
        previousVersion,
        liveDir,
        versionDir,
      };
      logger.deploy(`deployment ${input.deploymentId} succeeded`, {
        projectId: input.projectId,
        version: input.version,
        sizeMb,
        files: files.length,
      });
      return result;
    } catch (error) {
      logger.deploy(`deployment ${input.deploymentId} failed, rolling back`, {
        projectId: input.projectId,
        version: input.version,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.restorePreviousDeploy(liveDir, previousVersion, input.projectId, previousConfig);
      storage.deletePath(versionDir);
      storage.deletePath(tempDir);
      throw error;
    }
  }

  async rollback(input: RollbackInput): Promise<RollbackResult> {
    const { storage, nginx, logger } = this.context;
    const liveDir = storage.projectLiveDir(input.projectId);
    const versionDir = storage.projectVersionDir(input.projectId, input.targetVersion);

    if (!storage.pathExists(versionDir)) {
      throw new DeploymentPipelineError(`Target version ${input.targetVersion} does not exist`);
    }

    logger.deploy(`rolling back ${input.projectId} to version ${input.targetVersion}`, {
      projectId: input.projectId,
      targetVersion: input.targetVersion,
    });

    try {
      storage.activateVersion(input.projectId, input.targetVersion);

      const config = generateSiteConfig({
        projectId: input.projectId,
        hostnames: input.hostnames,
        root: liveDir,
        port: this.context.port,
      });
      await nginx.applySiteConfig(input.projectId, config);

      const result: RollbackResult = {
        version: input.version,
        targetVersion: input.targetVersion,
        url: `http://${input.primaryHostname}`,
        liveDir,
        versionDir,
      };
      logger.deploy(`rollback ${input.deploymentId} succeeded`, {
        projectId: input.projectId,
        targetVersion: input.targetVersion,
      });
      return result;
    } catch (error) {
      logger.deploy(`rollback ${input.deploymentId} failed`, {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private collectFiles(
    extracted: {
      path: string;
      sizeBytes: number;
      mimeType: string | null;
      checksumSha256: string;
    }[],
  ): DeployedFile[] {
    return extracted.map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      checksumSha256: file.checksumSha256,
    }));
  }

  private async restorePreviousDeploy(
    liveDir: string,
    previousVersion: number | null,
    projectId: string,
    previousConfig: string | null,
  ): Promise<void> {
    const { storage, nginx } = this.context;
    try {
      storage.deletePath(liveDir);
      if (
        previousVersion !== null &&
        storage.pathExists(storage.projectVersionDir(projectId, previousVersion))
      ) {
        storage.restoreVersion(projectId, previousVersion);
      }
      if (previousConfig !== null) {
        await nginx.applySiteConfig(projectId, previousConfig);
      }
    } catch (error) {
      this.context.logger.deploy(`failed to restore previous deployment for ${projectId}`, {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
