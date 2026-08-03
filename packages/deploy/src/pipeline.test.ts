import AdmZip from "adm-zip";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HostingLogger } from "@hosting/logger";
import { StorageManager } from "@hosting/storage";
import { DeployService, DeploymentPipelineError } from "./pipeline.js";
import type { NginxController } from "@hosting/nginx";

const LIMITS = {
  maxEntries: 100,
  maxExtractedSizeBytes: 1024 * 1024,
  maxSingleFileSizeBytes: 512 * 1024,
};

class FakeNginx {
  configs = new Map<string, string>();
  validateCalls = 0;
  reloadCalls = 0;
  failNextApply = false;

  async readSiteConfig(projectId: string): Promise<string | null> {
    return this.configs.get(projectId) ?? null;
  }
  async applySiteConfig(projectId: string, content: string): Promise<void> {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error("nginx reload failed");
    }
    this.configs.set(projectId, content);
    this.validateCalls += 1;
    this.reloadCalls += 1;
  }
}

function noopLogger(): HostingLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    deploy: () => {},
    access: () => {},
    child: () => noopLogger(),
    close: () => {},
  };
}

function makeZip(entries: Record<string, string>): string {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, "utf8"));
  }
  const dir = mkdtempSync(join(tmpdir(), "pipeline-zip-"));
  const path = join(dir, "archive.zip");
  zip.writeZip(path);
  return path;
}

const projectId = "59eb4d08-0b93-4c63-a48d-3afd7cb6a78d";

describe("DeployService pipeline", () => {
  let base: string;
  let storage: StorageManager;
  let nginx: FakeNginx;
  let deploy: DeployService;

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  function setup(): void {
    base = mkdtempSync(join(tmpdir(), "pipeline-"));
    storage = new StorageManager({
      uploadDirectory: join(base, "uploads"),
      siteDirectory: join(base, "sites"),
      backupDirectory: join(base, "backups"),
      tempDirectory: join(base, "temp"),
    });
    storage.ensureRoots();
    nginx = new FakeNginx();
    deploy = new DeployService({
      storage,
      nginx: nginx as unknown as NginxController,
      logger: noopLogger(),
      limits: LIMITS,
      baseDomain: "localhost",
      port: 80,
    });
  }

  function input(version: number, zipPath: string) {
    return {
      projectId,
      projectName: "demo",
      deploymentId: `deployment-${version}`,
      version,
      uploadZipPath: zipPath,
      hostnames: ["demo.localhost"],
      primaryHostname: "demo.localhost",
      quotaMb: 10,
    };
  }

  it("deploys v1 then v2 and swaps the live symlink atomically", async () => {
    setup();
    const v1 = makeZip({ "index.html": "<h1>v1</h1>" });
    const first = await deploy.deploy(input(1, v1));
    expect(first.version).toBe(1);
    expect(readlinkSync(storage.projectLiveDir(projectId))).toBe(
      storage.projectVersionDir(projectId, 1),
    );
    expect(readFileSync(join(storage.projectLiveDir(projectId), "index.html"), "utf8")).toBe(
      "<h1>v1</h1>",
    );

    const v2 = makeZip({ "index.html": "<h1>v2</h1>", "app.js": "console.log(1)" });
    const second = await deploy.deploy(input(2, v2));
    expect(second.previousVersion).toBe(1);
    expect(readlinkSync(storage.projectLiveDir(projectId))).toBe(
      storage.projectVersionDir(projectId, 2),
    );
    expect(second.files).toHaveLength(2);
    expect(nginx.configs.has(projectId)).toBe(true);
  });

  it("records per-file checksums from extraction", async () => {
    setup();
    const zip = makeZip({ "index.html": "<h1>checksum</h1>" });
    const result = await deploy.deploy(input(1, zip));
    const file = result.files.find((entry) => entry.path === "index.html");
    expect(file?.checksumSha256).toBeDefined();
    expect(file?.checksumSha256).toHaveLength(64);
  });

  it("rejects an archive without index.html and restores nothing", async () => {
    setup();
    const zip = makeZip({ "style.css": "body{}" });
    await expect(deploy.deploy(input(1, zip))).rejects.toThrow(/index\.html/i);
    expect(existsSync(storage.projectLiveDir(projectId))).toBe(false);
    expect(existsSync(storage.projectVersionDir(projectId, 1))).toBe(false);
  });

  it("rejects an archive that exceeds the storage quota and leaves live intact", async () => {
    setup();
    const zip = makeZip({ "index.html": "<h1>quota</h1>" });
    const oversized = { ...input(1, zip), quotaMb: 0 };
    await expect(deploy.deploy(oversized)).rejects.toThrow(/quota/i);
    expect(existsSync(storage.projectLiveDir(projectId))).toBe(false);
  });

  it("restores the previous deployment when the new apply fails", async () => {
    setup();
    const v1 = makeZip({ "index.html": "<h1>v1</h1>" });
    await deploy.deploy(input(1, v1));

    nginx.failNextApply = true;
    const v2 = makeZip({ "index.html": "<h1>v2</h1>" });
    await expect(deploy.deploy(input(2, v2))).rejects.toThrow(/nginx reload failed/i);
    expect(readlinkSync(storage.projectLiveDir(projectId))).toBe(
      storage.projectVersionDir(projectId, 1),
    );
    expect(readFileSync(join(storage.projectLiveDir(projectId), "index.html"), "utf8")).toBe(
      "<h1>v1</h1>",
    );
  });

  it("rolls back to a previous version and repoints the live symlink", async () => {
    setup();
    const v1 = makeZip({ "index.html": "<h1>v1</h1>" });
    const v2 = makeZip({ "index.html": "<h1>v2</h1>" });
    await deploy.deploy(input(1, v1));
    await deploy.deploy(input(2, v2));
    expect(readlinkSync(storage.projectLiveDir(projectId))).toBe(
      storage.projectVersionDir(projectId, 2),
    );

    const result = await deploy.rollback({
      projectId,
      projectName: "demo",
      deploymentId: "rollback-1",
      version: 3,
      targetVersion: 1,
      hostnames: ["demo.localhost"],
      primaryHostname: "demo.localhost",
    });
    expect(result.targetVersion).toBe(1);
    expect(readlinkSync(storage.projectLiveDir(projectId))).toBe(
      storage.projectVersionDir(projectId, 1),
    );
    expect(readFileSync(join(storage.projectLiveDir(projectId), "index.html"), "utf8")).toBe(
      "<h1>v1</h1>",
    );
  });

  it("rejects rolling back to a missing version", async () => {
    setup();
    const zip = makeZip({ "index.html": "<h1>v1</h1>" });
    await deploy.deploy(input(1, zip));
    await expect(
      deploy.rollback({
        projectId,
        projectName: "demo",
        deploymentId: "rollback-x",
        version: 2,
        targetVersion: 99,
        hostnames: ["demo.localhost"],
        primaryHostname: "demo.localhost",
      }),
    ).rejects.toThrow(DeploymentPipelineError);
  });
});
