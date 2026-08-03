import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { NginxEngineConfig } from "./engine-config.js";

const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 50;
const LOCK_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 30_000;

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class NginxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NginxValidationError";
  }
}

export class NginxLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NginxLockError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process exclusive lock backed by an atomic lock file in the shared
 * temp directory. Ensures nginx mutation sequences (write/validate/reload)
 * never interleave between the API and worker processes on the same host.
 */
export class FileLock {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly lockPath: string) {}

  async withExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.acquire();
      try {
        return await fn();
      } finally {
        this.release();
      }
    } finally {
      release();
    }
  }

  private async acquire(): Promise<void> {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        const fd = openSync(this.lockPath, "wx");
        try {
          writeSync(fd, String(process.pid));
        } finally {
          closeSync(fd);
        }
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        try {
          const stats = statSync(this.lockPath);
          if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
            const owner = this.readOwner();
            if (owner === null || !isProcessAlive(owner)) {
              try {
                unlinkSync(this.lockPath);
              } catch {
                // Lock was removed between stat and unlink.
              }
              continue;
            }
          }
        } catch {
          // Lock was released between stat and unlink; retry.
        }
        if (Date.now() > deadline) {
          throw new NginxLockError(`Timed out acquiring ${this.lockPath}`);
        }
        await sleep(LOCK_POLL_MS);
      }
    }
  }

  private readOwner(): number | null {
    try {
      const raw = readFileSync(this.lockPath, { encoding: "utf8" }).trim();
      const pid = Number(raw);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  private release(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Already removed.
    }
  }
}

export class NginxController {
  private readonly lock: FileLock;

  constructor(private readonly config: NginxEngineConfig) {
    this.lock = new FileLock(join(this.config.tempDir, "nginx.lock"));
  }

  siteConfigPath(projectId: string): string {
    return join(this.config.sitesAvailableDir, `${projectId}.conf`);
  }

  enabledLinkPath(projectId: string): string {
    return join(this.config.sitesEnabledDir, `${projectId}.conf`);
  }

  async writeSiteConfig(projectId: string, content: string): Promise<void> {
    writeFileSync(this.siteConfigPath(projectId), content, { encoding: "utf8" });
  }

  async enableSite(projectId: string): Promise<void> {
    const linkPath = this.enabledLinkPath(projectId);
    if (existsSync(linkPath)) return;
    symlinkSync(`../sites-available/${projectId}.conf`, linkPath);
  }

  async disableSite(projectId: string): Promise<void> {
    const linkPath = this.enabledLinkPath(projectId);
    if (existsSync(linkPath)) unlinkSync(linkPath);
  }

  async removeSiteConfig(projectId: string): Promise<void> {
    await this.disableSite(projectId);
    const configPath = this.siteConfigPath(projectId);
    if (existsSync(configPath)) rmSync(configPath, { force: true });
  }

  async readSiteConfig(projectId: string): Promise<string | null> {
    const configPath = this.siteConfigPath(projectId);
    if (!existsSync(configPath)) return null;
    return readFileSync(configPath, { encoding: "utf8" });
  }

  async validate(): Promise<void> {
    await this.run(["-t"]);
  }

  async reload(): Promise<void> {
    await this.run(["-s", "reload"]);
  }

  /**
   * Atomically applies a site config under the cross-process nginx lock:
   * write config, enable site, validate, reload. Any failure leaves the
   * previous config in place (the caller restores it if needed).
   */
  async applySiteConfig(projectId: string, content: string): Promise<void> {
    await this.lock.withExclusive(async () => {
      await this.writeSiteConfig(projectId, content);
      await this.enableSite(projectId);
      await this.validate();
      await this.reload();
    });
  }

  /**
   * Atomically removes a site config under the cross-process nginx lock.
   */
  async removeSite(projectId: string): Promise<void> {
    await this.lock.withExclusive(async () => {
      await this.removeSiteConfig(projectId);
      await this.validate();
      await this.reload();
    });
  }

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(
          new NginxValidationError(
            `nginx ${args.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`,
          ),
        );
      }, COMMAND_TIMEOUT_MS);
      timer.unref();
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(
            new NginxValidationError(stderr || `nginx ${args.join(" ")} exited with code ${code}`),
          );
        }
      });
    });
  }
}
