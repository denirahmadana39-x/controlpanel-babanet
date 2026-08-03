import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAllowedStaticFile } from "@hosting/shared";
import { mimeTypeFor } from "./mime.js";
import { sanitizeRelativeZipPath, safeJoin } from "./paths.js";

export interface ZipLimits {
  maxEntries: number;
  maxExtractedSizeBytes: number;
  maxSingleFileSizeBytes: number;
}

export interface ExtractedFile {
  path: string;
  sizeBytes: number;
  mimeType: string | null;
  checksumSha256: string;
}

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

export function extractZipSafe(
  zipPath: string,
  destination: string,
  limits: ZipLimits,
): ExtractedFile[] {
  if (!existsSync(zipPath)) {
    throw new ArchiveValidationError("Uploaded archive not found");
  }
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new ArchiveValidationError("Archive is empty");
  }
  if (entries.length > limits.maxEntries) {
    throw new ArchiveValidationError(
      `Archive contains too many entries (${entries.length} > ${limits.maxEntries})`,
    );
  }

  const extracted: ExtractedFile[] = [];
  let totalSize = 0;

  for (const entry of entries) {
    const rawName = entry.entryName;
    if (entry.isDirectory) {
      const clean = sanitizeRelativeZipPath(rawName);
      if (clean.length > 0) mkdirSync(safeJoin(destination, clean), { recursive: true });
      continue;
    }

    const relative = sanitizeRelativeZipPath(rawName);
    if (relative.length === 0) continue;

    const declaredSize = entry.header.size;
    if (declaredSize > limits.maxSingleFileSizeBytes) {
      throw new ArchiveValidationError(`Archive entry exceeds size limit: ${rawName}`);
    }
    totalSize += declaredSize;
    if (totalSize > limits.maxExtractedSizeBytes) {
      throw new ArchiveValidationError(
        "Archive total size exceeds extraction limit (possible zip bomb)",
      );
    }

    if (!isAllowedStaticFile(relative) || isForbiddenDotPath(relative)) {
      throw new ArchiveValidationError(`Unsupported or dangerous file in archive: ${rawName}`);
    }

    const target = safeJoin(destination, relative);
    mkdirSync(dirname(target), { recursive: true });
    const data = entry.getData();
    if (data.length !== declaredSize) {
      throw new ArchiveValidationError(
        `Archive entry size mismatch (declared ${declaredSize}, actual ${data.length}): ${rawName}`,
      );
    }
    writeFileSync(target, data);
    const checksumSha256 = createHash("sha256").update(data).digest("hex");
    extracted.push({
      path: relative,
      sizeBytes: data.length,
      mimeType: mimeTypeFor(relative),
      checksumSha256,
    });
  }

  return extracted;
}

function isForbiddenDotPath(relative: string): boolean {
  const segments = relative.split("/");
  return segments.some(
    (segment) =>
      segment.startsWith(".") && segment !== ".well-known" && !segment.startsWith(".well-known/"),
  );
}

export function locateSiteRoot(extractedDir: string): string {
  const entries = readdirSync(extractedDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const directories = entries.filter((entry) => entry.isDirectory());
  if (files.length === 0 && directories.length === 1 && directories[0]) {
    return join(extractedDir, directories[0].name);
  }
  return extractedDir;
}
