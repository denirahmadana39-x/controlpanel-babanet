import AdmZip from "adm-zip";
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractZipSafe, locateSiteRoot, type ZipLimits } from "./zip.js";
import { PathTraversalError } from "./paths.js";

const LIMITS: ZipLimits = {
  maxEntries: 100,
  maxExtractedSizeBytes: 1024 * 1024,
  maxSingleFileSizeBytes: 512 * 1024,
};

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeZip(entries: Record<string, string>): string {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, "utf8"));
  }
  const path = join(tempDir(), "archive.zip");
  zip.writeZip(path);
  return path;
}

function makeCraftedZip(entryName: string): string {
  const zip = new AdmZip();
  zip.addFile("safe.txt", Buffer.from("x"));
  const entry = zip.getEntries()[0];
  if (!entry) throw new Error("expected an entry");
  entry.entryName = entryName;
  const path = join(tempDir(), "crafted.zip");
  zip.writeZip(path);
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("extractZipSafe", () => {
  it("extracts files and reports sizes, types and checksums", () => {
    const zip = makeZip({ "index.html": "<h1>hi</h1>", "style.css": "body{}" });
    const dest = tempDir();
    const files = extractZipSafe(zip, dest, LIMITS);
    expect(files).toHaveLength(2);
    const index = files.find((file) => file.path === "index.html");
    expect(index?.mimeType).toBe("text/html");
    expect(index?.checksumSha256).toHaveLength(64);
    expect(readFileSync(join(dest, "index.html"), "utf8")).toBe("<h1>hi</h1>");
  });

  it("rejects path traversal entries", () => {
    const zip = makeCraftedZip("../escape.txt");
    expect(() => extractZipSafe(zip, tempDir(), LIMITS)).toThrow(PathTraversalError);
  });

  it("rejects dangerous executables", () => {
    const zip = makeZip({ "shell.php": "<?php" });
    expect(() => extractZipSafe(zip, tempDir(), LIMITS)).toThrow(/dangerous file/i);
  });

  it("rejects hidden dotfiles", () => {
    const zip = makeZip({ ".env": "SECRET=1" });
    expect(() => extractZipSafe(zip, tempDir(), LIMITS)).toThrow(/dangerous file/i);
  });

  it("allows .well-known ACME challenges", () => {
    const zip = makeZip({ ".well-known/acme-challenge/token": "abc" });
    const dest = tempDir();
    const files = extractZipSafe(zip, dest, LIMITS);
    expect(files.some((file) => file.path.includes(".well-known"))).toBe(true);
  });

  it("rejects an empty archive", () => {
    const zip = makeZip({});
    expect(() => extractZipSafe(zip, tempDir(), LIMITS)).toThrow(/empty/i);
  });

  it("rejects oversized entries and zip bombs", () => {
    const smallLimits: ZipLimits = {
      maxEntries: 10,
      maxExtractedSizeBytes: 100,
      maxSingleFileSizeBytes: 50,
    };
    const zip = makeZip({ "big.txt": "x".repeat(200) });
    expect(() => extractZipSafe(zip, tempDir(), smallLimits)).toThrow(/size limit/i);
  });

  it("rejects a missing archive", () => {
    expect(() => extractZipSafe(join(tempDir(), "missing.zip"), tempDir(), LIMITS)).toThrow(
      /not found/i,
    );
  });
});

describe("locateSiteRoot", () => {
  it("flattens a single top-level directory", () => {
    const root = tempDir();
    const inner = join(root, "site");
    writeFileSync(join(root, "placeholder.txt"), "x");
    expect(locateSiteRoot(root)).toBe(root);
    rmSync(join(root, "placeholder.txt"));
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, "index.html"), "<h1>x</h1>");
    expect(locateSiteRoot(root)).toBe(inner);
  });

  it("returns the extraction dir when it already contains files", () => {
    const root = tempDir();
    writeFileSync(join(root, "index.html"), "<h1>x</h1>");
    expect(locateSiteRoot(root)).toBe(root);
    expect(existsSync(root)).toBe(true);
  });
});
