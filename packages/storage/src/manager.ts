import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { mimeTypeFor } from "./mime.js";
import { safeJoin, toPosixPath } from "./paths.js";

export interface StoragePaths {
  uploadDirectory: string;
  siteDirectory: string;
  backupDirectory: string;
  tempDirectory: string;
}

export interface SavedUpload {
  path: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface StorageEntry {
  path: string;
  type: "file" | "directory";
  sizeBytes: number;
  mimeType: string | null;
}

export class StorageManager {
  constructor(private readonly paths: StoragePaths) {}

  ensureRoots(): void {
    for (const directory of [
      this.paths.uploadDirectory,
      this.paths.siteDirectory,
      this.paths.backupDirectory,
      this.paths.tempDirectory,
    ]) {
      mkdirSync(directory, { recursive: true });
    }
  }

  sanitizeFilename(originalName: string): string {
    const base = originalName.split(/[\\/]/).pop() ?? "archive.zip";
    const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
    return cleaned.endsWith(".zip") ? cleaned : `${cleaned}.zip`;
  }

  async saveUpload(
    projectId: string,
    originalName: string,
    source: Readable,
  ): Promise<SavedUpload> {
    const safeName = this.sanitizeFilename(originalName);
    const projectUploadDir = join(this.paths.uploadDirectory, projectId);
    mkdirSync(projectUploadDir, { recursive: true });
    const target = join(projectUploadDir, `${Date.now()}-${randomUUID()}-${safeName}`);
    const partial = `${target}.part`;

    const hash = createHash("sha256");
    let sizeBytes = 0;
    const countingStream = new Transform({
      transform(
        chunk: Buffer,
        _encoding: string,
        callback: (error?: Error | null, data?: Buffer) => void,
      ): void {
        sizeBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(source, countingStream, createWriteStream(partial));
      renameSync(partial, target);
    } catch (error) {
      rmSync(partial, { force: true });
      throw error;
    }
    return { path: target, sizeBytes, checksumSha256: hash.digest("hex") };
  }

  listUploadDirs(): string[] {
    if (!existsSync(this.paths.uploadDirectory)) return [];
    return readdirSync(this.paths.uploadDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(this.paths.uploadDirectory, entry.name));
  }

  projectLiveDir(projectId: string): string {
    return safeJoin(this.paths.siteDirectory, projectId);
  }

  projectVersionDir(projectId: string, version: number): string {
    return safeJoin(this.paths.siteDirectory, `${projectId}.v${version}`);
  }

  tempExtractDir(deploymentId: string): string {
    return safeJoin(this.paths.tempDirectory, deploymentId);
  }

  listProjectVersionDirs(projectId: string): string[] {
    if (!existsSync(this.paths.siteDirectory)) return [];
    const dirs = readdirSync(this.paths.siteDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /\.v\d+$/.test(entry.name))
      .map((entry) => ({ name: entry.name, version: Number(/\.v(\d+)$/.exec(entry.name)?.[1]) }))
      .filter((entry) => entry.name.startsWith(`${projectId}.v`) && Number.isFinite(entry.version))
      .sort((a, b) => b.version - a.version)
      .map((entry) => join(this.paths.siteDirectory, entry.name));
    return dirs;
  }

  listTempDirs(): { path: string; mtimeMs: number }[] {
    if (!existsSync(this.paths.tempDirectory)) return [];
    return readdirSync(this.paths.tempDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const path = join(this.paths.tempDirectory, entry.name);
        return { path, mtimeMs: statSync(path).mtimeMs };
      });
  }

  pathExists(target: string): boolean {
    return existsSync(target);
  }

  isDirectory(target: string): boolean {
    try {
      return lstatSync(target).isDirectory();
    } catch {
      return false;
    }
  }

  isManagedSymlink(target: string): boolean {
    try {
      return lstatSync(target).isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * Atomically points the project's live symlink at `projectId.v<version>`.
   * The swap uses a `.pending` link + rename so the live path is never observed
   * in a broken or partial state. Safe whether the live path exists or not.
   */
  activateVersion(projectId: string, version: number): void {
    const liveDir = this.projectLiveDir(projectId);
    const versionDir = this.projectVersionDir(projectId, version);
    const pendingLink = `${liveDir}.pending`;
    this.deletePath(pendingLink);
    symlinkSync(versionDir, pendingLink);
    renameSync(pendingLink, liveDir);
  }

  /**
   * Points the live symlink back at a previous version. The live path must not
   * exist (callers delete it first). Used when restoring the previous deploy
   * after a failed activation.
   */
  restoreVersion(projectId: string, version: number): void {
    const liveDir = this.projectLiveDir(projectId);
    const versionDir = this.projectVersionDir(projectId, version);
    symlinkSync(versionDir, liveDir);
  }

  /**
   * Reads the version the live symlink currently points at, or null when the
   * live path is missing or is not a managed symlink.
   */
  readLiveVersion(projectId: string): number | null {
    const liveDir = this.projectLiveDir(projectId);
    if (!existsSync(liveDir)) return null;
    try {
      const stats = lstatSync(liveDir);
      if (!stats.isSymbolicLink()) return null;
      const target = readlinkSync(liveDir);
      const match = /\.v(\d+)$/.exec(target);
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }

  listUploadFiles(projectId: string): string[] {
    const dir = safeJoin(this.paths.uploadDirectory, projectId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(dir, entry.name));
  }

  deletePath(target: string): void {
    rmSync(target, { recursive: true, force: true });
  }

  removeProjectStorage(projectId: string): void {
    this.deletePath(this.projectLiveDir(projectId));
    const siteEntries = readdirSync(this.paths.siteDirectory, { withFileTypes: true });
    for (const entry of siteEntries) {
      if (
        entry.name.startsWith(`${projectId}.v`) ||
        entry.name.startsWith(`${projectId}.pending`)
      ) {
        rmSync(safeJoin(this.paths.siteDirectory, entry.name), { recursive: true, force: true });
      }
    }
    this.deletePath(join(this.paths.uploadDirectory, projectId));
  }

  listTree(absoluteRoot: string): StorageEntry[] {
    const entries: StorageEntry[] = [];
    const walk = (currentDir: string, relativePrefix: string): void => {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const absolutePath = safeJoin(currentDir, entry.name);
        const relativePath =
          relativePrefix.length === 0 ? entry.name : `${relativePrefix}/${entry.name}`;
        const stats = lstatSync(absolutePath);
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) {
          entries.push({
            path: toPosixPath(relativePath),
            type: "directory",
            sizeBytes: 0,
            mimeType: null,
          });
          walk(absolutePath, relativePath);
        } else if (stats.isFile()) {
          entries.push({
            path: toPosixPath(relativePath),
            type: "file",
            sizeBytes: stats.size,
            mimeType: mimeTypeFor(entry.name),
          });
        }
      }
    };
    walk(absoluteRoot, "");
    return entries;
  }

  deleteTree(absoluteRoot: string, relativePath: string): boolean {
    const target = safeJoin(absoluteRoot, relativePath);
    if (!lstatSync(target).isFile() && !lstatSync(target).isDirectory()) {
      return false;
    }
    rmSync(target, { recursive: true, force: true });
    return true;
  }

  copyTree(sourceRoot: string, destinationRoot: string): { count: number; totalBytes: number } {
    let count = 0;
    let totalBytes = 0;
    const copy = (from: string, to: string): void => {
      const stats = lstatSync(from);
      if (stats.isSymbolicLink()) return;
      if (stats.isDirectory()) {
        mkdirSync(to, { recursive: true });
        for (const child of readdirSync(from)) {
          copy(join(from, child), safeJoin(to, child));
        }
      } else if (stats.isFile()) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        totalBytes += stats.size;
        count += 1;
      }
    };
    copy(sourceRoot, destinationRoot);
    return { count, totalBytes };
  }

  computeSizeBytes(directory: string): number {
    const walk = (currentDir: string): number => {
      let total = 0;
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const absolutePath = join(currentDir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          total += walk(absolutePath);
        } else if (entry.isFile()) {
          total += statSync(absolutePath).size;
        }
      }
      return total;
    };
    return walk(directory);
  }
}
